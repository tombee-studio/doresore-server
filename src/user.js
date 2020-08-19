export default class User {
    constructor(user_id, name, icon) {
        this.user_id = user_id
        this.name = name
        this.icon = icon
        this.room = null
        this._host = null
        this._isReady = false
    }

    ready() {
        this._isReady = true
    }

    isReady() {
        return this._isReady
    }

    host(socket, room) {
        this._host = room
        if(socket)
            socket.emit('you are host', { 'name': room.name })
    }

    join(socket, room) {
        this.room = room
        if(socket)
            socket.emit('join room', { 'name': room.name })
    }

    logout() {
        if(this.room) this.room.leave(this)
    }
}
