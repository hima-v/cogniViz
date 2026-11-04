FROM python:3.12.5-bookworm

RUN apt update && \
    apt install -y curl make git pandoc cmake

WORKDIR /root/msv

COPY requirements.txt /root/msv

RUN pip install -r requirements.txt

## Install R 4.5.3

ENV R_VERSION 4.5.3

RUN curl -O https://cdn.posit.co/r/debian-12/pkgs/r-${R_VERSION}_1_$(dpkg --print-architecture).deb && \
    apt-get install -y ./r-${R_VERSION}_1_$(dpkg --print-architecture).deb && \
    rm ./r-${R_VERSION}_1_$(dpkg --print-architecture).deb

RUN ln -s /opt/R/${R_VERSION}/bin/R /usr/local/bin/R ; ln -s /opt/R/${R_VERSION}/bin/Rscript /usr/local/bin/Rscript

## All installation is done with P3M binary packages, pinned at
## the date of R release, i.e. R version 4.5.3 (2026-03-11)

RUN Rscript -e "options(repos = 'https://packagemanager.posit.co/cran/__linux__/bookworm/2026-03-11'); install.packages(c('ggplot2', 'data.table', 'here', 'lmerTest', 'rmarkdown'), lib=.Library)"

CMD ["make"]
