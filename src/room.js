import { Observable } from 'rx'
import { setImmediate } from 'timers'
import Dataset from '../dataset.json'
import conf from 'config'
import Util from './util'
import lwl from 'lwl'

export default class Room {
    constructor(io, room_id, name, password, numMembers, icon, isCertified) {
        this.state = Room.GameState.GAME_OVER
        this.room_id = room_id
        this.name = name
        this.password = password
        this.numMembers = numMembers
        this.isCertified = isCertified
        this.icon = icon
        this.limitTime = Number(process.env.LIMIT_TIME)
        this.labels = Dataset.filter(item => {
            return ['book', 
                    'scissors', 
                    'spoon', 
                    'kettle', 
                    'scooter',
                    'cherry',
                    'torii',
                    'car',
                    'glasses',
                    'fork'].includes(item.name)
        }).map(item => {
            item.buffer = process.env["TEST_ICON"]
            item.isOccupied = false
            item.userId = null
            return item
        })
        this._host = null
        this._usedColor = ['yellow','blue','red']
        this.members = [] 
    }

    get result() {
        const ranks = []
        const rankings = {}
        const members = this.members.slice(0, this.members.length)
        members.sort((user1, user2) => user2.items.length - user1.items.length)
        members.forEach((user, index) => {
            ranks[index] = rankings[user.user_id] = 1 + 
                (members[index - 1] && members[index - 1].items.length != members[index].items.length 
                    && ranks[index - 1]? ranks[index - 1]: 0)
        })

        const buffers = this.members.map(user => user.items.map(
            item => item.buffer.replace('data:image/jpeg;base64,', '')))
        buffers.forEach(buffer => {
            while(buffer.length < 3) buffer.push('')
        })

        return {
            'base64ImageRepresentation': buffers.map(buffer => buffer.join(',')).join(','),
            'result_state': this.state,
            'icon_str': this.members.map(user => user.icon).join(','),
            'ranks': this.members.map(user => rankings[user.user_id]).join(',')
        }
    }

    get ready() {
        const d = {}
        const okData = this.members.map(user => {
            return { 'is_ok': user.isOK() }
        })
        d['number'] = okData.length
        d['num_members'] = this.numMembers
        okData.forEach((element, index) => { d[index] = element });
        d['is_all_ok'] = Object.values(okData).every(item => item['is_ok'])
        return d
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
                'userId': user.twitterId,
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
            'hostId': this._host.twitterId,
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

        if(io) io.sockets.in(this.room_id)
            .emit(conf.EMIT.SEND_ROOM_DATA, this.getJoinRoomData())
    }

    host(io, user) {
        this._host = user
        this.join(io, user)
        if(io) io.sockets.in(this.room_id)
            .emit(conf.EMIT.SEND_ROOM_DATA, this.ready)
    }

    start(io) {
        io.sockets.in(this.room_id).emit('game start')
        setTimeout(() => {
            const names = this.labels.map((item) => item.name).join(',')
            const icons = this.labels.map((item) => item.icon).join(',')
            console.log(names)
            io.sockets.in(this.room_id).emit(conf.EMIT.SEND_ITEMS, {
                'player_icon_names': names,
                'seikai_item_data': icons
            })
            io.emit(conf.EMIT.SEND_MESSAGE, 'GAME START')
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
                        this.state = Room.GameState.TIME_OVER
                        io.sockets.in(this.room_id).emit(conf.EMIT.TIME_OVER)
                    }, 1000)
                })
        }, 3000)
    }

    judge(socket, io, buffer, value, user) {
        const ARRAY = this.labels
            .filter(item => !item.isOccupied)
            .map(item => item.name)
        const array = new Set(value.filter(item => {
            return ARRAY.includes(item.name.toLowerCase())
        }).filter(item => {
            return item.score > 0.5
        }).filter(item => {
            const bouding = item.boundingPoly.normalizedVertices
            const deltax = bouding[1].x - bouding[0].x
            const deltay = bouding[2].y - bouding[1].y
            return deltax > 0.3 || deltay > 0.3
        }).map(item => item.name.toLowerCase()))

        const a = [...array]
        console.log(ARRAY)
        console.log(a)

        if(a.length > 0) {
            a.forEach(elem => {
                this.labels.filter(item => item.name == elem)
                    .forEach(i => {
                        i.isOccupied = true
                        i.userId = user.user_id
                        i.buffer = buffer
                        user.pushItem(i)
                    })
                socket.broadcast.to(this.room_id).emit(conf.EMIT.OTHER_SUCCEED, {
                    'object_name': elem,
                    'other_name': user.name,
                    'color_name': user.color
                })
                socket.emit(conf.EMIT.CORRECT, {
                    'player_name': user.name,
                    'object_name': elem,
                    'color_name': user.color
                })
            })
            console.log(`CLEAR ${user.items.length}`)
            if(user.items.length >= conf.CLEAR_ITEM_NUMBER) {
                this.clear(socket, io)
            }
        } else {
            socket.emit(conf.EMIT.WRONG)
        }
    }

    clear(socket, io) {
        this.state = Room.GameState.GAME_OVER
        io.sockets.in(this.room_id).emit(conf.EMIT.GAME_OVER)
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
