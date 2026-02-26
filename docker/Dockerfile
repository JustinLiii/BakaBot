FROM python:3.12-trixie
# 本Dockerfile由水无书创建！真棒水无书 - Justin Li


# 设置时区和中文支持
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt-get update && apt-get install -y \
    # 基础工具
    git curl wget vim nano \
    htop tmux screen \
    tree jq yq \
    # 网络工具
    iproute2 net-tools dnsutils \
    telnet netcat-openbsd tcpdump \
    openssh-client \
    # 开发工具
    build-essential cmake make \
    python3-pip python3-dev \
    nodejs npm \
    # 其他实用工具
    rsync unzip zip \
    ca-certificates \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 设置中文环境
RUN sed -i 's/# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen zh_CN.UTF-8
ENV LANG=zh_CN.UTF-8 \
    LANGUAGE=zh_CN:zh \
    LC_ALL=zh_CN.UTF-8

# 安装bun
RUN curl -fsSL https://bun.sh/install | bash


# 安装uv
# Download the latest installer
ADD https://astral.sh/uv/install.sh /uv-installer.sh

# Run the installer then remove it
RUN sh /uv-installer.sh && rm /uv-installer.sh

# Ensure the installed binary is on the `PATH`
ENV PATH="/root/.local/bin/:$PATH"

# 设置工作目录
WORKDIR /workspace

# 默认命令
CMD ["/bin/bash"]