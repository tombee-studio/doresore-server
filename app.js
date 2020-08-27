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
import lwl from 'lwl/lib/lwl'

RoomIDGenerator.generate('0123456789', 4)

const app = express()
const http = Server(app)
const io = SocketIO(http)
const ifaces = os.networkInterfaces()
const TEST_ICON = process.env["TEST_ICON"]

const PORT = process.env.PORT || 3000

const _users = {}
const _rooms = {}

const users = new Proxy(_users, {
    set: (target, name, value) => {
        Reflect.set(target, name, value)
        io.emit(conf.EMIT.UPDATE_LOGIN_USERS, Object.values(users).map(user => {
            return {
                'id': user.user_id,
                'name': user.name
            }
        }))
        return true
    },
    deleteProperty: function(target, prop) {
        Reflect.deleteProperty(target, prop)
        io.emit(conf.EMIT.UPDATE_LOGIN_USERS, Object.values(users).map(user => {
            return {
                'id': user.user_id,
                'name': user.name
            }
        }))
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
    lwl.notice(`${socket.id} connected`)
    socket.emit(conf.EMIT.CHECK_USER_ID)

    socket.on(conf.ON.TEST, (data) => {
        lwl.notice(`**ON** ${conf.ON.TEST}`)
        io.emit(conf.EMIT.SEND_MESSAGE, data)
    })

    socket.on(conf.ON.SEND_USER_ID, (userId) => {
        console.log(`**ON** ${conf.ON.SEND_USER_ID} ${userId}`)
        if(!userId) {
            userId = uuidv4()
            console.log('USER IDのないアクセスがあります')
            socket.emit(conf.EMIT.GENERATE_USER_ID,  userId)
        } else {
            if(userId in users && users[userId].room)
                socket.join(users[userId].room.room_id)
        }
    })

    socket.on(conf.ON.LOGIN, (data) => {
        console.log(`**ON** ${conf.ON.LOGIN}`)
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.name) != 'string') {
            console.log(`nameが存在しません`)
            return
        }

        const user_id = data.userId
        const name = data.name
        const icon = 'data:image/jpeg;base64,' + (data.icon || TEST_ICON)
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
        console.log(`**ON** ${conf.ON.MAKE_ROOM}`)
        console.log(data)
        if(typeof(data.password) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.num_members) != 'number') {
            console.log(`data.num_membersは${typeof(data.num_members)}`)
            return
        }
        if(typeof(data.userId) != 'string') {
            console.log(`USER ID: ${data.userId}は存在しておりません`)
            return
        }
        if(!data.userId in users) {
            console.log(`USER ID: ${data.userId}はログインしておりません`)
            return
        }
        if(typeof(data.isCertified) != 'boolean') {
            console.log(`isCertifiedは存在しておりません: ${typeof(data.isCertified)}`)
            return
        }

        const roomId = RoomIDGenerator.use()
        const name = roomId
        const password = data.password
        const numMembers = data.num_members
        const isCertified = data.isCertified
        const room = new Room(io, roomId, name, password, numMembers, TEST_ICON, isCertified)
        const user = users[data.userId]
        io.emit(conf.EMIT.SEND_MESSAGE, `${roomId}が${user.name}によって作られました`)
        socket.join(roomId)
        rooms[roomId] = room
        room.host(io, user)
        user.host(socket, room)
    })

    socket.on(conf.ON.JOIN_ROOM, (data) => {
        console.log(`**ON** ${conf.ON.JOIN_ROOM}`)
        console.log(data)
        if(!data.userId) {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.roomId) {
            console.log(`roomIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        if(!data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }

        const user = users[data.userId]
        const room = rooms[data.roomId]
        if(!room.isJoinable()) {
            socket.emit(conf.EMIT.RUNTIME_ERROR, {
                'code': 10,
                'message': 'すでにルームの参加可能人数を超えています',
                'numMembers': room.numMembers
            })
            return
        }

        socket.join(data.roomId)
        user.join(socket, room)
        room.join(io, user)
    })

    socket.on(conf.ON.JOIN_DIRECT, (data) => {
        console.log(`**ON** ${conf.ON.JOIN_DIRECT}`)
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.roomId) != 'string') {
            console.log(`roomIdが存在しません`)
            return
        }
        if(typeof(data.pass) != 'string') {
            console.log(`passが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        if(!data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }
        
        const room = rooms[data.roomId]
        const user = users[data.userId]
        if(room.isJoinable()) {
            if(room.isCertified) {
                if(data.pass != room.password) {
                    socket.emit(conf.EMIT.FAIL_JOIN)
                    return
                }
            }
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

    socket.on(conf.ON.DELETE_ROOM, (data) => {
        console.log(`**ON** ${conf.ON.DELETE_ROOM}`)
        if(typeof(data.roomId) != 'string') {
            console.log(`roomIdが存在しません`)
            return
        }
        if(!data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }
        
        delete rooms[data.roomId]
    })

    socket.on(conf.ON.GET_ROOM_DATA, (data) => {
        console.log(`**ON** ${conf.ON.GET_ROOM_DATA}`)
        const roomInfo = Object.values(rooms).map((room) => { 
            return { 
                'owner_name': room._host.name,
                'people': `${room.members.length}/${room.numMembers}`,
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
        console.log(`**ON** ${conf.ON.LEAVE_ROOM}`)
        if(!data) {
            console.log(`dataがundefinedです`)
            return
        }
        if(typeof(data.userId) != 'string') {
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
        console.log(`**ON** ${conf.ON.BREAK_ROOM}`)
        if(!data) {
            console.log(`dataが存在しません`)
            return
        }
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        const user = users[data.userId]
        if(!user.room) {
            console.log(`${data.userId}はルームに所属していません`)
            return
        }
        const room = user.room
        if(!user.isHost()) {
            console.log(`${data.userId}はホストではありません`)
            return
        }
        room.members.forEach(user => {
            user.leave(socket, io)
        })
        RoomIDGenerator.unuse(user.room.room_id)
        delete rooms[user.room.room_id]
    })

    socket.on(conf.ON.PLAYER_READY, (data) => {
        console.log(`**ON** ${conf.ON.PLAYER_READY}`)
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[data.userId]
        if(!user.room) {
            console.log(`${user.name}はルームに所属していません`)
            return
        }
        user.ok()
        io.in(user.room.room_id).emit('is ok', user.room.ready)
    })

    socket.on(conf.ON.START_GAME, (data) => {
        console.log(`**ON** ${conf.ON.START_GAME}`)
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const user = users[data.userId]
        if(user.room) user.room.start(io)
    })

    socket.on(conf.ON.SEND_IMAGE, (data) => {
        console.log(`**ON** ${conf.ON.SEND_IMAGE}`)
        console.log(data.userId)
        if(!data.buffer) {
            console.log(`bufferが存在しません`)
            return
        }
        if(!data.userId) {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
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
        console.log(`**ON** ${conf.ON.REQUIRE_RESULT}`)
        if(typeof(data.userId) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }
        if(!users[data.userId].room) {
            console.log(`${users[data.userId].name} はRoomに所属していません`)
            return
        }

        const user = users[data.userId]
        console.log(user.room.result['base64ImageRepresentation'][0].slice(0, 10))
        socket.emit(conf.EMIT.SEND_RESULT, user.room.result)
        user.logout(socket, io)
        delete users[data.userId]
    })

    socket.on(conf.ON.LOGOUT, (data) => {
        console.log(`**ON** ${conf.ON.LOGOUT}`)
        if(!data.userId) {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.userId in users) {
            console.log(`${data.userId}はログインしていません`)
            return
        }

        const userId = data.userId
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
})
