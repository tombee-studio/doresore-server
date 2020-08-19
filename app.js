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

config()

const PORT = process.env.PORT || 3000;

const app = express()
const http = Server(app)
const io = SocketIO(http)
const ifaces = os.networkInterfaces()
// const IP = ifaces['en0'][1]['address']

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

    const u = users['testuser'] = new User('testuser', 'taro', null)
    const r = rooms['0000'] = new Room('0000', '0000', '0000', 3)
    u.join(null, r)
    r.join(null, u)
    r.host(null, u)
    u.host(null, r)
    
    app.get('/' , (req, res) => {
        res.sendFile(__dirname + '/public/index.html')
    })
    
    io.on('connection', (socket) => {
        socket.emit('check user id')

        socket.on('test', (data) => {
            console.log(data)
            io.emit('send message', data)
        })
    
        socket.on('send user id', (userId) => {
            if(!userId) {
                userId = uuidv4()
                socket.emit('generate user id', userId)
            }
        })
    
        socket.on('login', (data) => {
            const user_id = data.userId
            const name = data.name
            if(user_id in users) {
                socket.emit('runtime error', {
                    'code': 20,
                    'message': 'ユーザIDはすでにログインしています'
                })
            } else {
                users[user_id] = new User(user_id, name, null, socket)
                socket.broadcast.emit('send message', `${name} が参加しました`)
            }
        })
    
        socket.on('make room', (data) => {
            io.emit('send message', `メッセージを${data}から受け取りました`)
            const roomId = uuidv4()
            const name = data.name
            const password = data.password
            const numMembers = data.num_members
            const room = new Room(roomId, name, password, numMembers)
            const user = users[data.userId]
            rooms[roomId] = room
            user.join(socket, room)
            room.join(io, user)
            room.host(io, user)
            user.host(socket, room)
            socket.join(roomId)
        })
    
        socket.on('join room', (data) => {
            const room = rooms[data.roomId]
            const user = users[data.userId]
            const password = data.password
    
            if(room.isJoinable()) {
                user.join(socket, room)
                room.join(io, user)
                socket.join(room.room_id)
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
                    'image': "",
                    'room_id': room.room_name
                } 
            })
            const d = {'number': roomInfo.length}
            for(const index of roomInfo.keys()) {
                d[index] = roomInfo[index]
            }
            socket.emit('return_room', d)
        })
    
        socket.on('start game', (data) => {
            const user = users[data.userId]
            if(user.room) {
                user.room.start(io)
            }
        })
    
        socket.on('send image', (data) => {
            const buffer = data.buffer
            const user = users[data.userId]
            try {
                Vision.getInstance().detect(buffer)
                .then((value) => {
                    if(user.room)
                        user.room.judge(socket, io, buffer, value)
                }).catch((error) => {
                    console.log(error)
                })
            } catch(ex) {
                console.log(ex)
            }
        })
    
        socket.on('logout', (userId) => {
            socket.broadcast.emit('send message', `${users[userId].name} がログアウトしました`)
            if(userId in users) {
                users[userId].logout()
                delete users[userId]
            }
        })
    })
    
    http.listen(PORT, () => {
        console.log(`Local:   http://localhost:${PORT}/`)
        // console.log(`Network: http://${IP}:${PORT}/`)
    })    
} catch(ex) {
    console.log(ex)
}
