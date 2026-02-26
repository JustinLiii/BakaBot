# bakabot

To install dependencies:

```bash
bun install
```

To run:

```bash
# 第一次运行前请先拉取镜像，否则 Agent 第一次执行 Bash 指令时会因为拉取镜像耗时过长而导致超时失败
docker pull juztinlii/bakabot-sandbox
bun run index.ts
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
