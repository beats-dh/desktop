FROM ubuntu:22.04

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG DEBIAN_FRONTEND=noninteractive

# baseline dependencies for all versions
RUN apt update && apt install -y software-properties-common lsb-release \
    sudo wget curl build-essential jq autoconf automake \
    pkg-config ca-certificates rpm

# arm64-specific dependencies
RUN apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu binutils-aarch64-linux-gnu

ENV AS=aarch64-linux-gnu-as
ENV STRIP=aarch64-linux-gnu-strip
ENV AR=aarch64-linux-gnu-ar
ENV CC=aarch64-linux-gnu-gcc
ENV CPP=aarch64-linux-gnu-cpp
ENV CXX=aarch64-linux-gnu-g++
ENV LD=aarch64-linux-gnu-ld
ENV FC=aarch64-linux-gnu-gfortran
ENV PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
ENV npm_config_arch=arm64

# Node 22 LTS runs on the amd64 host that performs the cross-compile.
# Ubuntu 22.04's glibc (2.35) satisfies the official build's >=2.28 requirement.
RUN curl -sL 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-linux-x64.tar.xz' | xzcat | tar -vx  --strip-components=1 -C /usr/local/
RUN npm install --global yarn

# install new enough git to work with repository
# Manual PPA setup — see ubuntu-amd64-packaging/Dockerfile for rationale.
# `add-apt-repository` calls api.launchpad.net which times out frequently.
RUN install -d -m 0755 /etc/apt/keyrings && \
    curl -sSf 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xE1DD270288B4E6030699E45FA1715D88E1DF1F24' \
      | gpg --dearmor -o /etc/apt/keyrings/git-core.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/git-core.gpg] https://ppa.launchpadcontent.net/git-core/ppa/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) main" \
      > /etc/apt/sources.list.d/git-core-ppa.list
RUN apt update && apt install -y git
RUN git --version

ENTRYPOINT ["/entrypoint.sh"]
