import { Observable } from 'rx'
import { setImmediate } from 'timers'
import Jimp from 'jimp'
import Dataset from '../dataset.json'
import fs from 'fs'
import sharp from 'sharp'
import conf from 'config'
import Util from './util'

export default class Room {
    constructor(io, room_id, name, password, numMembers, icon) {
        this.state = Room.GameState.GAME_OVER
        this.room_id = room_id
        this.name = name
        this.password = password
        this.numMembers = numMembers
        this.icon = icon
        this.limitTime = Number(process.env.LIMIT_TIME)
        this.labels = this.random(Dataset, 10).map((item) => {
            item.buffer = process.env["TEST_ICON"]
            item.isOccupied = false
            item.userId = null
            return item
        })
        this._host = null
        this._usedColor = Util.shuffle(['red', 'blue', 'yellow'])
        this.members = new Proxy([], {
            set: (target, property, val, receiver) => {
                Reflect.set(target, property, val, receiver)
                if(io && property != 'length') {
                    setTimeout(() => {
                        io.sockets.in(this.room_id)
                            .emit(conf.EMIT.SEND_ROOM_DATA, this.getJoinRoomData())
                    }, 1000)
                }
                return true
            },
            deleteProperty: (target, property) => {
                Reflect.deleteProperty(target, property)
                if(io && property != 'length') {
                    setTimeout(() => {
                        io.sockets.in(this.room_id)
                            .emit(conf.EMIT.SEND_ROOM_DATA, this.getJoinRoomData())
                    }, 1000)
                }
                return true
            }
        })
    }

    get result() {
        const members = this.members.slice(0, this.members.length)
        members.sort((user1, user2) => user1.items.length - user2.items.length)
        const rankings = {}
        members.forEach(user => {
            rankings[user.user_id] = 1
        })

        return {
            'base64ImageRepresentation': this.members.map(user => user.items.map(
                item => item.buffer).join(',')),
            'result_state': this.state,
            'icon_str': this.members.map(user => user.icon).join(','),
            'ranks': this.members.map(user => rankings[user.user_id]).join(',')
        }
    }

    random(array, num) {
        var a = array
        var t = []
        var r = []
        var l = a.length
        var n = num < l ? num : l
        while (n-- > 0) {
            var i = Math.random() * l | 0
            r[n] = t[i] || a[i]
            --l
            t[i] = t[l] || a[l]
        }
        return r
    }

    isJoinable() {
        return this.numMembers > this.members.length
    }

    getJoinRoomData() {
        const membersData = this.members.map((user) => {
            return {
                'userId': user.user_id,
                'user_name': user.name,
                'icon': user.icon,
                'your_host': user.isHost,
                'color': user.color
            }
        })

        const data = {
            'room': this.name,
            'pass': this.password,
            'members': `${this.members.length}/${this.numMembers}`,
            'hostId': this._host.user_id,
            'number': membersData.length
        }

        for(let i = 0; i < membersData.length; i++) {
            data[String(i)] = membersData[i]
        }
        return data
    }

    join(io, user) {
        user.color = this._usedColor.pop()
        this.members.push(user)
    }

    host(io, user) {
        this._host = user
        this.join(io, user)
        if(io)
            io.sockets.in(this.room_id).emit(conf.EMIT.SEND_MESSAGE, `${this.name} のホストは ${user.name} になりました`)
    }

    start(io) {
        const names = this.labels.map((item) => item.name).join(',')
        const icons = this.labels.map((item) => item.icon).join(',')
        console.log(names)
        io.sockets.in(this.room_id).emit(conf.EMIT.SEND_ITEMS, {
            'player_icon_names': names,
            'seikai_item_data': icons
        })
        io.sockets.in(this.room_id).emit(conf.EMIT.SEND_MESSAGE, 'GAME START')
        io.sockets.in(this.room_id).emit(conf.EMIT.SEND_COUNT, {
            'times': String(this.limitTime)
        })
        this.subscriber = Observable.interval(1000)
            .timeInterval()
            .take(this.limitTime).subscribe((x) => {
                io.sockets.in(this.room_id).emit(conf.EMIT.SEND_COUNT, {
                    'times': String(this.limitTime - x.value - 1)
                })
            }, (err) => {
                console.log(err)
            }, () => {
                setImmediate(() => {
                    io.sockets.in(this.room_id).emit(conf.EMIT.TIME_OVER)
                    this.state = Room.GameState.TIME_OVER
                }, 1000)
            })
    }

    judge(socket, io, buffer, value, user) {
        const ARRAY = this.labels
            .filter(item => !item.isOccupied)
            .map(item => item.name)
        const array = value.filter(item => {
            return ARRAY.includes(item.name.toLowerCase())
        }).filter(item => {
            return item.score > 0.5
        }).filter(item => {
            const bouding = item.boundingPoly.normalizedVertices
            const deltax = bouding[1].x - bouding[0].x
            const deltay = bouding[2].y - bouding[1].y
            return deltax > 0.3 || deltay > 0.3
        })

        console.log(ARRAY)
        console.log(array)

        if(array.length > 0) {
            array.forEach(elem => {
                this.labels.filter(item => item.name == elem.name.toLowerCase())
                    .forEach(elem => {
                        elem.isOccupied = true
                        elem.userId = user.user_id
                        elem.buffer = buffer
                        user.pushItem(elem)
                    })
                io.in(this.room_id).emit(conf.EMIT.OTHER_SUCCEED, {
                    'object_name': elem.name,
                    'other_name': user.name,
                    'color_name': user.color
                })
                socket.emit(conf.EMIT.CORRECT, {
                    'player_name': user.name,
                    'obj_name': elem.name,
                    'color_name': user.color
                })
            })
            if(user.items.length > conf.CLEAR_ITEM_NUMBER) this.clear()
        } else {
            socket.emit(conf.EMIT.WRONG)
        }
    }

    clear() {
        if(this.subscriber) this.subscriber.unsubscribe()
        this.state = Room.GameState.GAME_OVER
        socket.emit('you win')
        socket.broadcast.in(this.room_id).emit('you fail')
    }

    leave(user, socket, io) {
        const index = this.members.findIndex(u => u.user_id == user.user_id)
        if(index > -1) {
            socket.leave(this.room_id)
            this.members.splice(index, 1)
            this._usedColor.push(user.color)
            io.in(this.room_id).emit(conf.EMIT.SEND_MESSAGE, `${user.name} が退室しました`)
        }
    }
}

Room.GameState = {
    WAITING: 'waiting',
    READY: 'ready', 
    PLAYING: 'playing', 
    TIME_OVER: 'timeover', 
    GAME_OVER: 'gameover'
}
