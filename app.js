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
import conf from 'config'

RoomIDGenerator.generate('0123456789', 4)

const app = express()
const http = Server(app)
const io = SocketIO(http)
const ifaces = os.networkInterfaces()
const TEST_ICON = process.env["TEST_ICON"]

const PORT = process.env.PORT || 3000

const users = {}
const rooms = {}

const u = users['testuser'] = new User('testuser', 'taro', TEST_ICON)
const r = rooms['0000'] = new Room(io, '0000', '0000', '0000', 100, TEST_ICON)
r.host(null, u)
u.host(null, r)

app.get('/' , (req, res) => {
    res.sendFile(__dirname + '/public/index.html')
})

io.on(conf.ON.CONNECTION, (socket) => {
    console.log(`**ON** ${socket.id} CONNECTED`)
    socket.emit(conf.EMIT.CHECK_USER_ID)

    socket.on(conf.ON.TEST, (data, ack) => {
        console.log(`**ON** ${conf.ON.TEST}`)
        if(ack) ack({
            'message': 'This is a pen.'
        })
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
        if(typeof(data.name) != 'string') {
            console.log(`nameが存在しません`)
            return
        }

        const twitterId = data.userId
        const user_id = socket.id
        const name = data.name
        const icon = 'data:image/jpeg;base64,' + (data.icon || TEST_ICON)
        if(user_id in users) {
            socket.emit(conf.EMIT.RUNTIME_ERROR, {
                'code': 20,
                'message': 'ユーザIDはすでにログインしています'
            })
            return;
        } 
        users[user_id] = new User(user_id, twitterId, name, icon)
        users[user_id].init()
    })

    socket.on(conf.ON.MAKE_ROOM, (data) => {
        console.log(`**ON** ${conf.ON.MAKE_ROOM}`)
        if(typeof(data.password) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(typeof(data.num_members) != 'number') {
            console.log(`data.num_membersは${typeof(data.num_members)}`)
            return
        }
        if(typeof(socket.id) != 'string') {
            console.log(`USER ID: ${socket.id}は存在しておりません`)
            return
        }
        if(!socket.id in users) {
            console.log(`USER ID: ${socket.id}はログインしておりません`)
            return
        }
        if(typeof(data.isCertified) != 'boolean') {
            console.log(`isCertifiedは存在しておりません: ${typeof(data.isCertified)}`)
            return
        }

        const user = users[socket.id]
        if(user.room) return

        const roomId = RoomIDGenerator.use()
        const name = roomId
        const password = data.password
        const numMembers = data.num_members
        const isCertified = data.isCertified
        const room = new Room(io, roomId, name, password, numMembers, TEST_ICON, isCertified)
        io.emit(conf.EMIT.SEND_MESSAGE, `${roomId}が${user.name}によって作られました`)
        socket.join(roomId)
        rooms[roomId] = room
        room.host(io, user)
        user.host(socket, room)
    })

    socket.on(conf.ON.JOIN_ROOM, (data) => {
        console.log(`**ON** ${conf.ON.JOIN_ROOM}`)
        if(!socket.id) {
            console.log(`userIdが存在しません`)
            return
        }
        if(!data.roomId) {
            console.log(`roomIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }
        if(!data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }

        const user = users[socket.id]
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
        if(typeof(socket.id) != 'string') {
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
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }
        if(!data.roomId in rooms) {
            console.log(`${data.roomId}は存在しないルームです`)
            return
        }
        
        const room = rooms[data.roomId]
        const user = users[socket.id]
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
                'image': 'data:image/jpeg;base64,' + room.icon,
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
        if(typeof(socket.id) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }

        const user = users[socket.id]
        user.leave(socket, io)
    })

    socket.on(conf.ON.BREAK_ROOM, (data) => {
        console.log(`**ON** ${conf.ON.BREAK_ROOM}`)
        if(!data) {
            console.log(`dataが存在しません`)
            return
        }
        if(typeof(socket.id) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }
        const user = users[socket.id]
        if(!user.room) {
            console.log(`${socket.id}はルームに所属していません`)
            return
        }
        const room = user.room
        if(!user.isHost()) {
            console.log(`${socket.id}はホストではありません`)
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
        if(typeof(socket.id) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }

        const user = users[socket.id]
        if(!user.room) {
            console.log(`${user.name}はルームに所属していません`)
            return
        }
        user.ok()
        io.in(user.room.room_id).emit('is ok', user.room.ready)
    })

    socket.on(conf.ON.START_GAME, (data) => {
        console.log(`**ON** ${conf.ON.START_GAME}`)
        if(typeof(socket.id) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }

        const user = users[socket.id]
        if(user.room) user.room.start(io)
    })

    socket.on(conf.ON.SEND_IMAGE, (data) => {
        console.log(`**ON** ${conf.ON.SEND_IMAGE}`)
        console.log(socket.id)
        if(!data.buffer) {
            console.log(`bufferが存在しません`)
            return
        }
        if(!socket.id) {
            console.log(`userIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }

        const buffer = data.buffer
        const user = users[socket.id]
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

    socket.on(conf.ON.REQUIRE_RESULT, (data, ack) => {
        console.log(`**ON** ${conf.ON.REQUIRE_RESULT}`)
        if(typeof(socket.id) != 'string') {
            console.log(`userIdが存在しません`)
            return
        }
        if(!socket.id in users) {
            console.log(`${socket.id}はログインしていません`)
            return
        }
        if(!users[socket.id]) {
            console.log(`${socket.id}の実態がありません`)
            return
        }
        if(!users[socket.id].room) {
            console.log(`${users[socket.id].name} はRoomに所属していません`)
            return
        }

        const user = users[socket.id]
        user.gotResult()
        socket.emit(conf.EMIT.SEND_RESULT, user.room.result)
        if(user.room.members.every(user => user.isGotResult)) {
            const room_id = user.room.room_id
            user.room.members.forEach(u => {
                u.init()
            })
            delete rooms[room_id]
        }
    })

    socket.on('disconnect', (data) => {
        console.log(`**ON** ${socket.id} DISCONNECTED`)
        delete users[socket.id]
    })
})

http.listen(PORT, () => {
    console.log(`Local:   http://localhost:${PORT}/`)
})
