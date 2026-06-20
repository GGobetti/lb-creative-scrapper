import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { scanCommand } from "./commands/scan";

yargs(hideBin(process.argv))
  .scriptName("scraper")
  .usage("$0 <command> [options]")
  .command(
    "scan",
    "Escaneia grupos Telegram e faz upload de novos STLs para o Vault",
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
  .demandCommand(1, "Informe um comando. Ex: scraper scan --hours 48")
  .help()
  .parse();
