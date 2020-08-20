function combination(array1, array2) {
    let array = []
    for(const a of array1) {
        for(const b of array2) {
            array.push(a + b)
        }
    }
    return array
}

class _RoomIDGenerator {
    generate(use, digit) {
        let array = use.split('')
        const origin = use.split('')
        for(let i = 1; i < digit; i++) {
            array = combination(array, origin)
        }
        this.roomIDs = array
    }

    getRoomIDs() {
        return this.roomIDs
    }

    use() {
        const L = this.roomIDs.length
        const roomID = this.roomIDs[Math.floor(Math.random() * L)]
        this.roomIDs = this.roomIDs.filter(n => n != roomID)
        return roomID
    }

    unuse(roomID) {
        this.roomIDs.push(roomID)
    }
}

_RoomIDGenerator.getInstance = () => {
    if(!_RoomIDGenerator._instance) 
        _RoomIDGenerator._instance = new _RoomIDGenerator()
    return _RoomIDGenerator._instance
}

export default _RoomIDGenerator.getInstance()
