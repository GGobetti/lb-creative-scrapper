# lb-creative-scrapper — Instruções do Projeto

Worker **local** (roda na máquina do dono) que faz **ingestão** de STLs: lê grupos do Telegram (GramJS/MTProto), baixa os arquivos e os envia para o armazém. Arquitetura-alvo: o armazém é o **Cloudflare R2** (o Telegram Vault será aposentado). Não serve download para usuário final — isso é responsabilidade do `lb-creative-studio` (entrega via presigned URL do R2). Doc de arquitetura completa: `../lb-creative-studio/ARCHITECTURE.md`.

# Fluxo de Git — REGRA OBRIGATÓRIA

O dono não é expert em git e **não vai pedir** branch/PR/merge. O assistente **assume o fluxo de git por conta própria** em toda tarefa:

1. Avaliar risco antes de codar: código que muda comportamento/feature/fix não-trivial → **branch dedicada** (`feat/...`, `fix/...`, `chore/...`) a partir da `main` atualizada; docs/ajustes triviais podem ir direto.
2. Commits pequenos e descritivos.
3. **Push cedo e frequente** (o trabalho só está seguro depois do push para o GitHub).
4. Ao concluir e validar → abrir **PR** com descrição.
5. **Merge na `main`** após ok do dono; depois apagar a branch.
6. **Confirmar antes** de: merge na main, migrations, rotação de chaves, deleções, ou qualquer coisa sensível.
7. **Nunca commitar segredos** (`.env*`, `TELEGRAM_SESSION`, chaves). Manter `.gitignore` correto.
8. **Sempre narrar** os passos de git em linguagem simples — o dono não acompanha os comandos.

> O assistente cuida de branch → commit → push → PR → merge de ponta a ponta, narrando cada passo, e só pausa para pedir ok nos pontos sensíveis.
