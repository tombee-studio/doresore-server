export default class User {
    constructor(user_id, name, icon) {
        this.user_id = user_id
        this.name = name
        this.icon = icon
        this.room = null
        this._host = null
        this._isHost = false
        this._isOK = false
        this._color = null
        this._items = []
    }

    get items() { return this._items }
    get isHost() { return this._isHost }
    get color() {
        if(!this._color) {
            console.log(`${this.name} が意図しないアクセスをしました`)
            return null
        }
        return this._color
    }
    set color(c) {
        if(this._color) {
            console.log(`${this.name} のcolorはすでに設定されています`)
        }
        this._color = c
    }

    pushItem(item) {
        this._items.push(item)
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
        this._isHost = true
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
