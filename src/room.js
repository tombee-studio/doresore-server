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
        this.labels = this.random(Dataset, 10).map((item) => {
            item.buffer = null
            item.isOccupied = false
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

    join(io, user) {
        this.members.push(user)

        const membersData = this.members.map((user) => {
            return {
                'user_Id': this.user_id,
                'user_name': this.name,
                'icon': this.icon,
                'your_host': this._host != null
            }
        })

        const data = {
            'room': {
                'name': this.name,
                'pass': this.password,
                'members': `${this.members.length}/${this.numMembers}`,
                'hostId': this._host.user_Id
            }
        }

        for(let i = 0; i < membersData.length; i++) {
            data[i] = membersData[i]
        }

        data['numbers'] = membersData.length

        if(io)
            io.sockets.in(this.room_id).emit('join room', data)
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
        io.sockets.in(this.room_id).emit('time_receive', String(this.limitTime))
        // this.subscriber = Observable.interval(1000)
        //     .timeInterval()
        //     .take(this.limitTime).subscribe((x) => {
        //         io.sockets.in(this.room_id).emit('time_recieve', this.limitTime - x.value - 1)
        //     }, (err) => {
        //         console.log(err)
        //     }, () => {
        //         setImmediate(()=>{
        //             io.sockets.in(this.room_id).emit('time over')
        //         }, 1000)
        //     })
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
