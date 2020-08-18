import { Observable } from 'rx'
import { setImmediate } from 'timers'
import Jimp from 'jimp'
import Dataset from '../dataset.json'
import sharp from 'sharp'

export default class Room {
    constructor(room_id, name, password, numMember) {
        this.room_id = room_id
        this.name = name
        this.password = password
        this.numMembers = numMember
        this.limitTime = Number(process.env.LIMIT_TIME)
        this.labels = this.random(Dataset, 5).map((item) => {
            item.buffer = null
            item.isOccupied = false
            return item
        })
        this._host = null
        this.members = []
        console.log(this.labels)
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

    join(io, user) {
        this.members.push(user)
        io.sockets.in(this.room_id).emit('join new', { 
            'room': this.name, 
            'members': this.members.map((user) => {
                return {
                    'name': user.name, 
                    'icon': user.icon
                }
            })
        })
    }

    host(io, user) {
        this._host = user
        io.sockets.in(this.room_id).emit('send message', `${this.name} のホストは ${user.name} になりました`)
    }

    start(io) {
        io.sockets.in(this.room_id).emit('send labels', this.labels)
        io.sockets.in(this.room_id).emit('send count', this.limitTime)
        this.subscriber = Observable.interval(1000)
            .timeInterval()
            .take(this.limitTime).subscribe((x) => {
                io.sockets.in(this.room_id).emit('send count', this.limitTime - x.value - 1)
            }, (err) => {
                console.log(err)
            }, () => {
                setImmediate(()=>{
                    io.sockets.in(this.room_id).emit('time over')
                }, 1000)
            })
    }

    judge(socket, io, buffer, value) {
        const ARRAY = this.labels.map(item => item.name)
        const array = value.filter(item => {
            return ARRAY.includes(item.name.toLowerCase())
        }).filter(item => {
            return item.score > 0.8
        }).filter(item => {
            const bouding = item.boundingPoly.normalizedVertices
            const deltax = bouding[1].x - bouding[0].x
            const deltay = bouding[2].y - bouding[1].y
            return deltax > 0.5 || deltay > 0.5
        })
        if(array.length > 0) {
            socket.emit('succeed', this.labels)
        } else {
            socket.emit('failure')
        }
    }

    clear() {
        if(this.subscriber) this.subscriber.unsubscribe()
    }

    leave(socketID) {
        
    }
}
