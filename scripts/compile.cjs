// Compile contracts/*.sol with solc-js -> artifacts/<Name>.json { abi, bytecode }
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "contracts");
const OUT = path.join(ROOT, "artifacts");

function readSources() {
  const sources = {};
  for (const f of fs.readdirSync(SRC)) {
    if (f.endsWith(".sol")) sources[f] = { content: fs.readFileSync(path.join(SRC, f), "utf8") };
  }
  return sources;
}

function compile() {
  const input = {
    language: "Solidity",
    sources: readSources(),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris", // safe, widely-supported target
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors = (out.errors || []).filter((e) => e.severity === "error");
  const warnings = (out.errors || []).filter((e) => e.severity === "warning");
  warnings.forEach((w) => console.warn("warn:", w.formattedMessage.trim()));
  if (errors.length) {
    errors.forEach((e) => console.error(e.formattedMessage));
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  for (const file of Object.keys(out.contracts)) {
    for (const name of Object.keys(out.contracts[file])) {
      const c = out.contracts[file][name];
      const artifact = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
      fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(artifact, null, 2));
      console.log("compiled", name, "->", "artifacts/" + name + ".json");
    }
  }
}

compile();
