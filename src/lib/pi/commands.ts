/**
 * Commands for the Raspberry Pi LoRa gateway, built from the scripts in
 * https://github.com/NCAR/mesonet-siparcs25/tree/main/edge-servers
 *
 * That repo's files assume the Pi account is called `ncar` and that the code
 * lives in /home/ncar/mesonet-siparcs25/edge-servers (setup_and_run.sh and
 * lora-gateway.service both hard-code it). Anyone using another username has to
 * change those paths, so the guide generates the exact commands for theirs.
 */
export const REPO_URL = "https://github.com/NCAR/mesonet-siparcs25.git";
export const REPO_TREE = "https://github.com/NCAR/mesonet-siparcs25/tree/main/edge-servers";
export const SERVICE = "lora-gateway";
const SHIPPED_USER = "ncar";

export type PiInput = {
  user: string;
  hostname: string;
  broker: string;
  port: number;
  topic: string;
  edgeId: string;
};

export const DEFAULTS: PiInput = {
  user: "ncar",
  hostname: "lora-gateway",
  // These are the values in the repo's own pi_config.json.
  broker: "iotwx.ucar.edu",
  port: 1883,
  topic: "sensors/{station_id}",
  edgeId: "default_pi",
};

/** Linux account names Raspberry Pi Imager accepts. */
export const validUser = (u: string) => /^[a-z_][a-z0-9_-]{0,31}$/.test(u);
export const validHost = (h: string) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(h);
export const validBroker = (b: string) => /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(b);

/** Where the code must live: the service and setup script both expect exactly this. */
export const codeDir = (user: string) => `/home/${user}/mesonet-siparcs25/edge-servers`;

export function sshCommand(i: PiInput) {
  return `ssh ${i.user}@${i.hostname}.local`;
}

export function cloneCommands(i: PiInput) {
  return [
    "sudo apt update && sudo apt install -y git",
    `git clone ${REPO_URL}`,
    `cd ${codeDir(i.user).replace(`/home/${i.user}`, "~")}`,
  ].join("\n");
}

/** Point the three files at this account. Nothing to do if the account is the shipped `ncar`. */
export function adaptCommand(i: PiInput): string | null {
  if (i.user === SHIPPED_USER) return null;
  return `sed -i 's#/home/${SHIPPED_USER}#/home/${i.user}#g; s#^User=${SHIPPED_USER}$#User=${i.user}#; s#^Group=${SHIPPED_USER}$#Group=${i.user}#' setup_and_run.sh lora-gateway.service deploy.sh`;
}

/** The repo's pi_config.json with this gateway's broker and name. Other radio settings stay as shipped. */
export function configJson(i: PiInput): string {
  return JSON.stringify(
    {
      mqtt: { broker_ip: i.broker, broker_port: i.port, msg_topic_template: i.topic },
      radio: {
        edge_id: i.edgeId,
        rcv_timeout: 0.5,
        pong_duration: 3.0,
        pong_initial_delay_max: 1.5,
        overload_threshold: 0.85,
        pi_station_midpoint: 5,
        pi_station_steepness: 1,
        pi_cpu_weight: 0.4,
        pi_mem_weight: 0.3,
        pi_station_weight: 0.3,
      },
    },
    null,
    2,
  );
}

export function writeConfigCommand(i: PiInput): string {
  return `cat > pi_config.json <<'EOF'\n${configJson(i)}\nEOF`;
}

/** What deploy.sh does, for people who want to see it. */
export const DEPLOY_EXPLAINED = [
  "chmod +x setup_and_run.sh",
  `sudo cp lora-gateway.service /etc/systemd/system/lora-gateway.service`,
  "sudo systemctl daemon-reload",
  "sudo systemctl enable lora-gateway   # start at every boot",
  "sudo systemctl start lora-gateway    # start now",
].join("\n");

export const RUN = "bash deploy.sh";
export const STATUS = "systemctl status lora-gateway";
export const LOGS = "journalctl -u lora-gateway -f";
export const STOP_NOW = "sudo systemctl stop lora-gateway";
export const STOP_FOR_GOOD = "sudo systemctl disable --now lora-gateway";
export const RESTART = "sudo systemctl restart lora-gateway";
export const UPDATE = `git pull && sudo systemctl restart lora-gateway`;
