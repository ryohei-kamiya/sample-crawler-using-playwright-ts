FROM mcr.microsoft.com/playwright:v1.33.0-jammy
RUN apt-get update && apt-get -y upgrade && apt-get -y install language-pack-ja

ENV TZ=Asia/Tokyo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
ENV PYTHONIOENCODING=utf-8
ENV LC_ALL='ja_JP.UTF-8'
ENV LANG='ja_JP.UTF-8'
ENV USER crawler

ARG UID=1234
RUN useradd -u ${UID} -m ${USER} && mkdir -p /${USER}
COPY ./package.json /${USER}/package.json
RUN chown -R ${USER}:${USER} /${USER}

WORKDIR /${USER}
USER ${USER}
