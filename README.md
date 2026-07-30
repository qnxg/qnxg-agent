# qnxg agent

易千 agent，一个实验性质的项目。可以通过封装好的工具查询 GreptimeDB ，并通过内置的 quickjs 灵活统计数据。agent 部分直接采用了 pi sdk，所以会加载电脑上的 pi agent 的模型配置。

pi的配置文件主要有两个 auth.json 和 model.json，其中 auth.json 会重定向到项目内，而 model.json 目前还是加载本地的 model.json。

## 运行

1. 配置 pi 的模型，[参考文档](https://pi.dev/docs/latest/models)
2. 配置环境变量

```
GREPTIME_USERNAME=user_name
GREPTIME_PASSWORD=your_password_here
GREPTIME_URL=https://your_website.com/v1/sql
```

3. 运行即可

```
npm install
npm start
```

## feature

目前只有在线查询和 js 工具可用，不过已经可以完成不少任务了。

提问样例：
- 查询一下电费查询接口的情况
- 统计一下7月20日的异常记录

## TODO

目前想到的有这些，排名不分前后

- [ ] 补充更多提示词，它现在连有哪些接口都不知道
- [ ] 开放读取本地代码的工具权限（现在把所有内置工具全都禁用了），可以直接在后端与爬虫代码里追踪问题
- [ ] 自动提 issue / pr
- [ ] 更美观的界面，考虑使用 openTUI，也没准搞 gui 
- [ ] 自动唤醒，比如代码检测到异常状态后自动唤醒 agent 排查问题
- [ ] 接入 qq 机器人
