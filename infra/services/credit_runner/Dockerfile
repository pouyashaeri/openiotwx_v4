# CREDIT forecast runner. Same recipe as mesonet-siparcs25/cloud/services/credit: Miniforge,
# miles-credit installed in a conda env, GFS initialization, realtime rollout. The runner loop
# (runner.py) replaces the one-shot credit.sh so forecast requests from the website are picked
# up as they arrive. Build with --build-arg ENV_FILE=environment.yml on a CUDA host.
FROM nvidia/cuda:12.2.0-base-ubuntu22.04

ARG ENV_NAME=credit
ARG ENV_FILE=environment_cpu.yml
ARG ARCHITECTURE=x86_64
ARG CREDIT_REF=main
ENV ENV_NAME=${ENV_NAME} CONDA_DIR=/opt/conda PATH=/opt/conda/bin:$PATH MINIFORGE_VERSION=23.3.1-0

RUN apt-get update && apt-get install -y --no-install-recommends curl git wget bzip2 ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN wget -q https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/Miniforge3-Linux-${ARCHITECTURE}.sh -O /tmp/miniforge.sh \
    && bash /tmp/miniforge.sh -b -p ${CONDA_DIR} && rm /tmp/miniforge.sh

WORKDIR /app
RUN git clone --depth 1 --branch ${CREDIT_REF} https://github.com/NCAR/miles-credit.git miles-credit
WORKDIR /app/miles-credit
RUN conda env create -n ${ENV_NAME} -f ${ENV_FILE} && conda run -n ${ENV_NAME} pip install -e . \
    && conda run -n ${ENV_NAME} pip install requests xarray netCDF4 zarr
WORKDIR /app
COPY model.yml runner.py extract_station.py ./
COPY pin.py ./pin.py
CMD ["conda", "run", "--no-capture-output", "-n", "credit", "python", "-u", "runner.py"]
