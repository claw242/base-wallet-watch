import { executerCli } from "./cli.js";

const resultat = await executerCli(process.argv.slice(2));
(resultat.code === 2 ? console.error : console.log)(resultat.sortie);
process.exitCode = resultat.code;
