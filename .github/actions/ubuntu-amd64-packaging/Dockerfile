FROM ubuntu:22.04

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG DEBIAN_FRONTEND=noninteractive

# baseline dependencies for all versions
RUN apt update && apt install -y software-properties-common lsb-release \
    sudo wget curl build-essential jq autoconf automake \
    pkg-config ca-certificates rpm

# add electron unit test dependencies
RUN apt install -y libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 \
    libexpat1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 \
    libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    libsecret-1-0

ENV AS=as
ENV STRIP=strip
ENV AR=ar
ENV CC=gcc
ENV CPP=cpp
ENV CXX=g++
ENV LD=ld
ENV FC=gfortran
ENV PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig
ENV npm_config_arch=x64

# Node 22 LTS (official linux-x64 build). Required by:
#   - `process-proxy` (engines: >=22)
#   - `--experimental-test-module-mocks` flag in script/test.mjs (added 22.3.0)
# Ubuntu 22.04's glibc (2.35) satisfies the official build's >=2.28 requirement.
RUN curl -sL 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-linux-x64.tar.xz' | xzcat | tar -vx  --strip-components=1 -C /usr/local/
RUN npm install --global yarn

# install new enough git to work with repository
#
# The previous form was `add-apt-repository ppa:git-core/ppa -y`, but that
# tool hits api.launchpad.net at build time to look up the PPA's metadata,
# and Launchpad's API is regularly slow / times out from Docker build hosts.
# We add the PPA the manual way instead: drop the deb line straight into
# sources.list.d and fetch the signing key from keyserver.ubuntu.com (much
# more reliable than the API). Same end state, build doesn't depend on
# Launchpad being responsive.
RUN install -d -m 0755 /etc/apt/keyrings && \
    curl -sSf 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xE1DD270288B4E6030699E45FA1715D88E1DF1F24' \
      | gpg --dearmor -o /etc/apt/keyrings/git-core.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/git-core.gpg] https://ppa.launchpadcontent.net/git-core/ppa/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) main" \
      > /etc/apt/sources.list.d/git-core-ppa.list
RUN apt update && apt install -y git
RUN git --version

# get-shell-env-test spawns `$SHELL -ilc printenvz` with env={} and asserts
# PATH is in printenvz's output. /bin/sh on Ubuntu is dash, which only reads
# ~/.profile (absent in /github/home), so it never exports PATH. Force bash
# (which sources /etc/profile + /etc/profile.d/*.sh on -l) and seed PATH via
# profile.d since Ubuntu's default profile chain doesn't export it itself.
ENV SHELL=/bin/bash
RUN echo 'export PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"' > /etc/profile.d/00-set-path.sh \
    && chmod +x /etc/profile.d/00-set-path.sh

ENTRYPOINT ["/entrypoint.sh"]
