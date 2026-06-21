import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { scanCommand } from "./commands/scan";
import { daemonCommand } from "./commands/daemon";

yargs(hideBin(process.argv))
  .scriptName("scraper")
  .usage("$0 <command> [options]")
  .command(
    "scan",
    "Escaneia grupos Telegram e faz upload de novos STLs para o Vault (uma vez)",
    (y) =>
      y.option("hours", {
        alias: "h",
        type: "number",
        default: 24,
        description: "Janela de tempo em horas para buscar msgs",
      }),
    async (argv) => {
      await scanCommand({ hours: argv.hours });
    }
  )
  .command(
    "daemon",
    "Roda o scraper em loop infinito com scan a cada N minutos (recomendado)",
    (y) =>
      y.option("hours", {
        alias: "h",
        type: "number",
        default: 24,
        description: "Janela de tempo em horas para buscar msgs",
      })
      .option("interval", {
        alias: "i",
        type: "number",
        default: 30,
        description: "Intervalo em minutos entre scans",
      }),
    async (argv) => {
      await daemonCommand({ hours: argv.hours, interval: argv.interval });
    }
  )
  .demandCommand(1, "Informe um comando: scan ou daemon")
  .help()
  .parse();
