import vision from '@google-cloud/vision'

export default class Vision {

    constructor() {
        this.client = new vision.ImageAnnotatorClient()
    }

    static getInstance() {
        if(!Vision._instance) Vision._instance = new Vision()
        return Vision._instance
    }

    async detect(buffer) {
        const request = {
            "image": {
                "content": buffer
            }
        }
        const [result] = await this.client.objectLocalization(request)
        return result.localizedObjectAnnotations
    }
}
