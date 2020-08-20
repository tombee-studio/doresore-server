import { Observable } from 'rx'
import { setImmediate } from 'timers'
import Jimp from 'jimp'
import Dataset from '../dataset.json'
import fs from 'fs'
import sharp from 'sharp'

export default class Room {
    constructor(room_id, name, password, numMembers, icon) {
        this.room_id = room_id
        this.name = name
        this.password = password
        this.numMembers = numMembers
        this.icon = icon
        this.limitTime = Number(process.env.LIMIT_TIME)
        this.labels = this.random(Dataset, 10).map((item) => {
            item.buffer = null
            item.isOccupied = false
            item.userId = null
            return item
        })
        this._host = null
        this.members = []
    }

    random(array, num) {
        var a = array;
        var t = [];
        var r = [];
        var l = a.length;
        var n = num < l ? num : l;
        while (n-- > 0) {
          var i = Math.random() * l | 0;
          r[n] = t[i] || a[i];
          --l;
          t[i] = t[l] || a[l];
        }
        return r;
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
                'your_host': user._host === this._host
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
        this.members.push(user)
        if(io) {
            setTimeout(() => {
                io.sockets.in(this.room_id).emit('join room', this.getJoinRoomData())
            }, 1000)
        }
    }

    host(io, user) {
        this._host = user
        this.join(io, user)
        if(io)
            io.sockets.in(this.room_id).emit('send message', `${this.name} のホストは ${user.name} になりました`)
    }

    start(io) {
        const names = this.labels.map((item) => item.name).join(',')
        const icons = this.labels.map((item) => item.icon).join(',')
        console.log(names)
        io.sockets.in(this.room_id).emit('item_receive', {
            'player_icon_names': names,
            'seikai_item_data': icons
        })
        io.sockets.in(this.room_id).emit('send message', 'GAME START')
        io.sockets.in(this.room_id).emit('time_receive', {
            'times': String(this.limitTime)
        })
        this.subscriber = Observable.interval(1000)
            .timeInterval()
            .take(this.limitTime).subscribe((x) => {
                io.sockets.in(this.room_id).emit('time_receive', {
                    'times': String(this.limitTime - x.value - 1)
                })
            }, (err) => {
                console.log(err)
            }, () => {
                setImmediate(() => {
                    io.sockets.in(this.room_id).emit('time over')
                }, 1000)
            })
    }

    judge(socket, io, buffer, value, user) {
        console.log(user.name)
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

        console.log(this.labels.map(item => {
            return {
                'name': item.name,
                'flag': item.isOccupied
            }
        }))

        console.log(value)

        if(array.length > 0) {
            array.forEach(elem => {
                this.labels.filter((item) => item.name == elem.name.toLowerCase()).
                    forEach(elem => {
                        elem.isOccupied = true
                        elem.userId = user.user_id
                    })
                io.in(this.room_id).emit('other succeed', {
                    'object_name': elem.name,
                    'other_name': user.name
                })
                socket.emit('you_correct_receive', {
                    'player_name': user.name,
                    'obj_name': elem.name
                })
            })
        } else {
            socket.emit('you_false_receive')
        }
    }

    clear() {
        if(this.subscriber) this.subscriber.unsubscribe()
    }

    leave(user, socket, io) {
        socket.leave(this.room_id)
        this.members = this.members.filter((u) => u !== user)
        io.in(this.room_id).emit('send message', `${user.name} が退室しました`)
    }
}
