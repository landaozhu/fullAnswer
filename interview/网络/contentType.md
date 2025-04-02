用于区分数据类型
get 请求的 headers 没有 content-type
## 格式
Content-Type：type/subtype;parameter

type：主类型，任意的字符串，如text，如果是*号代表所有；
subtype：子类型，任意的字符串，如html，如果是*号代表所有，用“/”与主类型隔开；
parameter：可选参数，如charset，boundary等
## 常见类型
- text/plain：纯文本格式；
- text/html：HTML格式；
- text/css：Cascading Style Sheets；
- text/javascript：JavaScript代码；
- application/json：JSON格式数据；
- application/xml：XML格式数据；
- application/octet-stream
    - 用途: 用于发送原始的二进制数据，通常用于文件上传，尤其是当不知道文件的确切类型时。
    - 格式: 直接传递文件的二进制数据，没有其他编码或分隔符。
    - 示例: 发送一个二进制文件流。
- image/jpeg：JPEG格式图片；
- image/gif：GIF格式图片；
- image/png：PNG格式图片；
- audio/mpeg：MP3格式音频；
- video/mp4：MP4格式视频；
- application/pdf
- application/graphql
- application/graphql
    - 用途: 用于发送 GraphQL 查询语句。
    - 格式: 发送的是 GraphQL 的查询字符串。
    - 示例:
    ```
    {
        user(id: "1") {
            name
            age
        }
    }
    ```

- multipart/form-data：表单数据；
- application/x-www-form-urlencoded
    - 用途: 用于发送表单数据，默认的 Content-Type，适用于较小的简单表单。

    - 格式: 数据会以键值对的方式编码，类似于 URL 查询字符串的格式，键值对之间以 & 分隔，键和值都经过 URL 编码处理。
    - 例子
        ```
        name=John+Doe&age=30
        ```
- multipart/related
    - 用途: 类似于 multipart/form-data，但用于在一个请求中传递多个相关的部分，如 JSON 和二进制文件组合。常用于复杂的 API 请求，如某些 RESTful API 上传文件和元数据一起使用。
    - 格式: 包含多个部分，每个部分可以有自己的 Content-Type，并且各部分之间是相关的。
    - 示例: 用于上传图片和元数据的请求。
- application/soap+xml
    - 用途: 用于 SOAP 协议的 Web 服务请求和响应，这种编码类型用于发送 SOAP 消息，它使用 XML 格式。
    - 格式: SOAP 消息以 XML 形式发送，遵循 SOAP 标准。
    - 例子
    ```
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:m="http://www.example.org/stock">
    <soap:Header/>
    <soap:Body>
        <m:GetStockPrice>
            <m:StockName>IBM</m:StockName>
        </m:GetStockPrice>
    </soap:Body>
    </soap:Envelope>
    ```
## 参考
- [Content-type详解](https://blog.csdn.net/qq_44741577/article/details/136507746)