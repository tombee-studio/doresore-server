import { config } from 'dotenv'
config()

import User from './src/user'
import Room from './src/room'
import Vision from './src/vision'
import os from 'os'
import express from 'express'
import SocketIO from 'socket.io'
import sharp from 'sharp'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import RoomIDGenerator from './src/room-id-generator'
import assert from 'assert'
import conf from 'config'

RoomIDGenerator.generate('0123456789', 4)

const app = express()
const http = Server(app)
const io = SocketIO(http)
const ifaces = os.networkInterfaces()
const TEST_ICON = process.env["TEST_ICON"]

const PORT = process.env.PORT || 3000
// const IP = ifaces['en0'][3].address

const _users = {}
const _rooms = {}

const users = new Proxy(_users, {
    set: (target, name, value) => {
        Reflect.set(target, name, value)
        io.emit(conf.EMIT.UPDATE_LOGIN_USERS, Object.keys(users).length)
        return true
    },
    deleteProperty: function(target, prop) {
        Reflect.deleteProperty(target, prop)
        io.emit(conf.EMIT.UPDATE_LOGIN_USERS, Object.keys(users).length)
        return true
    }
})

const rooms = new Proxy(_rooms, {
    set: (target, name, value) => {
        Reflect.set(target, name, value)
        io.emit(conf.EMIT.UPDATE_ROOMS, Object.values(rooms).map((item) => {
            return {
                room_id: item.roomId,
                name: item.name
            }
        }))
        return true
    },
    deleteProperty: function(target, prop) {
        Reflect.deleteProperty(target, prop)
        io.emit(conf.EMIT.UPDATE_ROOMS, Object.values(rooms).map((item) => {
            return {
                room_id: item.roomId,
                name: item.name
            }
        }))
        return true
    }
})

const u = users['testuser'] = new User('testuser', 'taro', TEST_ICON)
const r = rooms['0000'] = new Room(io, '0000', '0000', '0000', 100, TEST_ICON)
r.host(null, u)
u.host(null, r)

app.get('/' , (req, res) => {
    res.sendFile(__dirname + '/public/index.html')
})

io.on(conf.ON.CONNECTION, (socket) => {
    console.log(`${socket.id} connected`)
    socket.emit(conf.EMIT.CHECK_USER_ID)

    socket.on(conf.ON.TEST, (data) => {
        io.emit(conf.EMIT.SEND_MESSAGE, data)
    })

    socket.on(conf.ON.SEND_USER_ID, (userId) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!userId) {
            userId = uuidv4()
            socket.emit(conf.EMIT.GENERATE_USER_ID,  userId)
        } else {
            if(userId in users && users[userId].room)
                socket.join(users[userId].room.room_id)
        }
    })

    socket.on(conf.ON.LOGIN, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.name) == 'string') {
            console.log(`nameが存在しません`)
            return
        }

        const user_id = data.userId
        const name = data.name
        const icon = 'data:image/jpeg;base64,' + data.icon || TEST_ICON
        if(user_id in users) {
            socket.emit(conf.EMIT.RUNTIME_ERROR, {
                'code': 20,
                'message': 'ユーザIDはすでにログインしています'
            })
        } else {
            users[user_id] = new User(user_id, name, icon)
            socket.broadcast.emit(conf.EMIT.SEND_MESSAGE, `${name} が参加しました`)
        }
    })

    socket.on(conf.ON.MAKE_ROOM, (data) => {
        if(typeof(data.password) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.num_members) == 'int') {
            console.log(`data.num_membersは${data.num_members}`)
            return
        }
        if(typeof(data.userId) == 'string') {
            console.log(`USER ID: ${data.userId}はログインしておりません`)
            return
        }

        const roomId = RoomIDGenerator.use()
        const name = roomId
        const password = data.password
        const numMembers = data.num_members
        const room = new Room(io, roomId, name, password, numMembers, TEST_ICON)
        const user = users[data.userId]
        io.emit(conf.EMIT.SEND_MESSAGE, `${roomId}が${user.name}によって作られました`)
        socket.join(roomId)
        rooms[roomId] = room
        room.host(io, user)
        user.host(socket, room)
    })

    socket.on(conf.ON.JOIN_ROOM, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.roomId) == 'string') {
            console.log(`roomIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        if(data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }
        
        const room = rooms[data.roomId]
        const user = users[data.userId]
        if(room.isJoinable()) {
            socket.join(data.roomId)
            user.join(socket, room)
            room.join(io, user)
        } else {
            socket.emit(conf.EMIT.RUNTIME_ERROR, {
                'code': 10,
                'message': 'すでにルームの参加可能人数を超えています',
                'numMembers': room.numMembers
            })
        }
    })

    socket.on(conf.ON.GET_ROOM_DATA, (data) => {
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
        socket.emit(conf.EMIT.RETURN_ROOM_DATA, d)
    })

    socket.on(conf.ON.LEAVE_ROOM, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[data.userId]
        user.leave(socket, io)
    })

    socket.on(conf.ON.BREAK_ROOM, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[data.userId]
    })

    socket.on(conf.ON.PLAYER_READY, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

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

    socket.on(conf.ON.START_GAME, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[data.userId]
        if(user.room) user.room.start(io)
    })

    socket.on(conf.ON.SEND_IMAGE, (data) => {
        if(typeof(data.buffer) == 'string') {
            console.log(`bufferが存在しません`)
            return
        }
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const buffer = data.buffer
        const user = users[data.userId]
        try {
            Vision.getInstance().detect(buffer)
                .then((value) => {
                    if(user.room)
                        user.room.judge(socket, io, buffer, value, user)
                }).catch((error) => {
                    console.log(error)
                })
        } catch(ex) {
            console.log(ex)
        }
    })

    socket.on(conf.ON.REQUIRE_RESULT, (data) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        if(users[data.userId].room) {
            console.log(`${users[data.userId].name} はRoomに所属していません`)
            return
        }

        const user = users[data.userId]
        console.log(user.room.result)
        socket.emit(conf.EMIT.SEND_RESULT, user.room.result)
    })

    socket.on(conf.ON.LOGOUT, (userId) => {
        if(typeof(data.userId) == 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[userId]
        socket.broadcast.emit(conf.EMIT.SEND_MESSAGE, `${user.name} がログアウトしました`)
        if(userId in users) {
            users[userId].logout(socket, io)
            delete users[userId]
        }
    })
})

http.listen(PORT, () => {
    console.log(`Local:   http://localhost:${PORT}/`)
    // console.log(`Network: http://${IP}:${PORT}/`)
})
