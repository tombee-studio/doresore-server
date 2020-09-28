module.exports = {
    target: 'node',
    entry: './app.js', 
    output: {
        path: __dirname + '/build',
        filename: 'compiled.js'
    },
    node: {
        __dirname: true,
    },
    module: {
        rules: [
            {
            test: /\.js$/,
            exclude: /node_modules/,
            use: {
                    loader: "babel-loader",
                    options: {
                        presets: ['@babel/preset-env']
                    }
                }
            }
        ]
    }
};