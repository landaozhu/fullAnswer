var http = require("http")
var url = require("url")
 
http.createServer((req, res) => {
    console.log(req)
    var urlobj = url.parse(req.url, true)
    console.log(urlobj.query.callback);
    switch (urlobj.pathname) {
        case "/api/aaa":
            res.end(`${urlobj.query.callback} (${JSON.stringify({
                name: '张三',
                age: 21
            })})`)
            break;
        default:
            res.end("404")
    }
}).listen(8001, () => {
    console.log("start");
})