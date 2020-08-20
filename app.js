import User from './src/user'
import Room from './src/room'
import Vision from './src/vision'
import os from 'os'
import express from 'express'
import SocketIO from 'socket.io'
import sharp from 'sharp'
import { config } from 'dotenv'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import RoomIDGenerator from './src/room-id-generator'

config()

RoomIDGenerator.generate('123', 3)

const app = express()
const http = Server(app)
const io = SocketIO(http)
const ifaces = os.networkInterfaces()
const TEST_ICON = process.env["TEST_ICON"]

const PORT = process.env.PORT || 3000;
const IP   = ifaces['en0'][1].address || '0.0.0.0'

const _users = {}
const _rooms = {}

try {
    const users = new Proxy(_users, {
        set: (target, name, value) => {
            Reflect.set(target, name, value)
            io.emit('update login users', Object.keys(users).length)
            return true
        },
        deleteProperty: function(target, prop) {
            Reflect.deleteProperty(target, prop)
            io.emit('update login users', Object.keys(users).length)
            return true
        }
    })
    
    const rooms = new Proxy(_rooms, {
        set: (target, name, value) => {
            Reflect.set(target, name, value)
            io.emit('update rooms', Object.values(rooms).map((item) => {
                return {
                    room_id: item.roomId,
                    name: item.name
                }
            }))
            return true
        },
        deleteProperty: function(target, prop) {
            Reflect.deleteProperty(target, prop)
            io.emit('update rooms', Object.values(rooms).map((item) => {
                return {
                    room_id: item.roomId,
                    name: item.name
                }
            }))
            return true
        }
    })

    const u = users['testuser'] = new User('testuser', 'taro', TEST_ICON)
    const r = rooms['0000'] = new Room('0000', '0000', '0000', 100, TEST_ICON)
    r.host(null, u)
    u.host(null, r)
    
    app.get('/' , (req, res) => {
        res.sendFile(__dirname + '/public/index.html')
    })
    
    io.on('connection', (socket) => {
        console.log(`${socket.id} connected`)
        socket.emit('check user id')

        socket.on('test', (data) => {
            console.log(data)
            io.emit('send message', data)
        })
    
        socket.on('send user id', (userId) => {
            console.log(`${userId} comes`)
            if(!userId) {
                userId = uuidv4()
                socket.emit('generate user id', userId)
            } else {
                if(userId in users && users[userId].room)
                    socket.join(users[userId].room.room_id)
            }
        })
    
        socket.on('login', (data) => {
            console.log('LOGIN')
            console.log(data)
            const user_id = data.userId
            const name = data.name
            const icon = 'data:image/jpeg;base64,' + data.icon || TEST_ICON
            if(user_id in users) {
                socket.emit('runtime error', {
                    'code': 20,
                    'message': 'ユーザIDはすでにログインしています'
                })
            } else {
                users[user_id] = new User(user_id, name, icon)
                socket.broadcast.emit('send message', `${name} が参加しました`)
            }
        })
    
        socket.on('make room', (data) => {
            console.log(data)
            const roomId = RoomIDGenerator.use()
            const name = roomId
            const password = data.password
            const numMembers = data.num_members
            const room = new Room(roomId, name, password, numMembers, TEST_ICON)
            const user = users[data.userId]
            io.emit('send message', `${roomId}が${user.name}によって作られました`)
            socket.join(roomId)
            rooms[roomId] = room
            room.host(io, user)
            user.host(socket, room)
        })
    
        socket.on('enter_room', (data) => {
            console.log(data)
            const room = rooms[data.roomId]
            const user = users[String(data.userId)]
    
            if(room.isJoinable()) {
                socket.join(data.roomId)
                user.join(socket, room)
                room.join(io, user)
            } else {
                socket.emit('runtime error', {
                    'code': 10,
                    'message': 'すでにルームの参加可能人数を超えています',
                    'numMembers': room.numMembers
                })
            }
        })
    
        socket.on('search_room', (data) => {
            const roomInfo = Object.values(rooms).map((room) => { 
                return { 
                    'owner_name': room._host.name,
                    'people': '1/3',
                    'pass': room.password,
                    'image': room.icon,
                    'room_id': room.name
                } 
            })
            const d = {'number': roomInfo.length}
            for(const index of roomInfo.keys()) {
                d[index] = roomInfo[index]
            }
            socket.emit('return_room', d)
        })

        socket.on('leave room', (data) => {
            const user = users[data.userId]
            user.leave(socket, io)
        })

        socket.on('change ok', (data) => {
            const user = users[data.userId]
            const d = {}
            if(user.room) {
                user.ok()
                const okData = user.room.members.map(user => {
                    return { 'is_ok': user.isOK() }
                })
                d['number'] = okData.length
                d['num_members'] = user.room.numMembers
                okData.forEach((element, index) => { d[index] = element });
                d['is_all_ok'] = Object.values(okData).every(item => item['is_ok'])
                io.in(user.room.roomId).emit('is ok', d)
            }
        })
    
        socket.on('start game', (data) => {
            const user = users[data.userId]
            if(user.room) user.room.start(io)
        })
    
        socket.on('img_send', (data) => {
            console.log(`img_send ${data.userId}`)
            const buffer = data.buffer
            const user = users[data.userId]
            try {
                Vision.getInstance().detect(buffer)
                .then((value) => {
                    if(user.room)
                        user.room.judge(socket, io, buffer, value, user.name)
                }).catch((error) => {
                    console.log(error)
                })
            } catch(ex) {
                console.log(ex)
            }
        })
    
        socket.on('logout', (userId) => {
            const user = users[userId]
            socket.broadcast.emit('send message', `${user.name} がログアウトしました`)
            if(userId in users) {
                users[userId].logout(socket, io)
                delete users[userId]
            }
        })
    })
    
    http.listen(PORT, () => {
        console.log(`Local:   http://localhost:${PORT}/`)
        console.log(`Network: http://${IP}:${PORT}/`)
    })    
} catch(ex) {
    console.log(ex)
}
