export default class User {
    constructor(user_id, name, icon) {
        this.user_id = user_id
        this.name = name
        this.icon = icon
        this.room = null
        this._host = null
        this._isOK = false
    }

    ok() {
        this._isOK = true
    }

    isOK() {
        return this._isOK
    }

    host(socket, room) {
        this.join(socket, room)
        this._host = room
        this._isOK = true
    }

    join(socket, room) {
        this.room = room
    }

    leave(socket, io) {
        if(this.room) this.room.leave(this, socket, io)
    }

    logout(socket, io) {
        if(this.room) this.room.leave(this, socket, io)
    }
}
