# Segurança na Migração: Supabase → R2

## O Risco: Perder Referências de Fotos

**Cenário de Desastre:**
```
1. Delete fotos de Supabase
2. URLs no banco ainda apontam para Supabase
3. Site tenta carregar fotos → 404 (quebradas)
```

**Solução:** Ordem EXATA de execução.

---

## Ordem Correta (à prova de falhas)

### ✅ Fase 1: Upload para R2 (sem mexer no banco)
**Task 3:** Backfill fotos Supabase → R2
- Copia todas as 1.376 fotos
- **NÃO deleta** nada de Supabase
- **NÃO altera** banco de dados
- Se falhar aqui: Supabase continua funcionando normalmente

**Task 7:** Backfill avatars Supabase → R2
- Copia avatar
- **NÃO deleta** nada
- Se falhar: Avatar antigo continua funcionando

### ✅ Fase 2: Atualizar URLs no Banco
**Task 5:** Atualizar `telegram_indexed_stls` (fotos + avatars)
- Troca URLs de `supabase.co` → `r2.cloudflarestorage.com`
- **DEPOIS disso**, o site aponta para R2
- Se falhar parcialmente: Rode script de novo (é idempotente)

### ✅ Fase 3: Validar Integridade
**Task 8:** Executar validação
```bash
npm run validate:migration
```
- Verifica que nenhuma URL aponta mais para Supabase
- Verifica que site carrega fotos de R2
- **SÓ depois de passar**, siga para limpeza

### ✅ Fase 4: Limpar Supabase
**Task 6:** Deletar fotos de Supabase
- Agora é SAFE porque banco aponta para R2
- Se algo der errado: Fotos estão em R2, site funciona
- Limpeza é apenas housekeeping, não afeta funcionamento

---

## Riscos Por Ordem de Execução Errada

| Ordem | O que acontece | Severidade |
|---|---|---|
| ✅ Upload → Update → Validate → Delete | Tudo bem | ✅ SAFE |
| ❌ Delete → Update → Upload | 404s enquanto atualiza | 🔴 CRÍTICO |
| ❌ Update → Upload → Delete | Aponta para R2 mas arquivo não existe | 🔴 CRÍTICO |
| ⚠️ Upload → Validate → Delete (sem update) | URLs no banco antigo | 🟡 PROBLEMA |

**Lição:** Validação (Task 8) é A CHAVE — garante que URLs foram atualizadas antes de deletar.

---

## Checklist Para Evitar Desastres

### Antes de Task 3 (Backfill Fotos)
```
- [ ] Backup SQL recente? (paranoia, não é obrigatório)
- [ ] Credenciais R2 validadas (Task 1)?
- [ ] Script roda em dry-run sem erro?
```

### Antes de Task 5 (Update URLs)
```
- [ ] Todos os 1.376 arquivos em R2? (Task 3 passou)
- [ ] Avatar em R2? (Task 7 passou)
- [ ] Nenhum erro em backfill?
```

### Antes de Task 6 (Delete Supabase)
```
- [ ] Task 5 completou 100%?
- [ ] npm run validate:migration PASSOU?
- [ ] Abriu site e clicou em algumas fotos? (visual check)
- [ ] Nenhuma erro 404 ao visualizar fotos?
```

**Se algum desses falhar: NÃO siga para próximo step.**

---

## Rollback (Se der Ruim)

**Cenário:** Após Task 5 (update URLs), descobrir que erro ocorreu.

**Ação 1:** Revert URLs no banco
```sql
-- Emergency: voltar para Supabase
UPDATE telegram_indexed_stls
SET thumbnail_url = regexp_replace(
  thumbnail_url, 
  'r2\.cloudflarestorage\.com', 
  'yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio'
)
WHERE thumbnail_url LIKE '%r2.cloudflarestorage%';

-- Fotinhas desnecessárias
UPDATE telegram_indexed_stls
SET photos = array_agg(
  regexp_replace(photo, 'r2\.cloudflarestorage\.com', 'yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio')
) 
FROM unnest(photos) as photo
WHERE photos[1] LIKE '%r2.cloudflarestorage%';
```

**Ação 2:** Site volta a funcionarem com URLs antigas de Supabase

**Ação 3:** Investigue o erro, ajuste script, rode de novo

**Ação 4:** Se Task 6 já foi executado, cópia está em R2 (não se perdeu nada)

---

## Garantias do Plano

### ✅ Fotos Não Serão Perdidas
- Upload é feito ANTES de deletar
- Cópia permanece em R2 mesmo se Supabase for deletado

### ✅ URLs Não Vão Ficar Quebradas
- Validação (Task 8) garante que URLs estão corretas
- Só depois de validar é que deletamos

### ✅ Migrations São Reversíveis
- Scripts são idempotentes (pode rodar de novo)
- Banco pode ser revertido com SQL

### ✅ Sem Downtime
- Site continua funcionando enquanto migra
- Só desligaria se alguém deletar Supabase SEM atualizar URLs

---

## Teste Local (Antes de Executar em Prod)

Se quiser testar o processo em escala reduzida:

```bash
# 1. Fazer backup SQL antes
pg_dump <seu-banco> > backup-pre-migration.sql

# 2. Rodar tudo em dry-run
npm run migrate:photos-to-r2 -- --dry-run
npm run migrate:avatars-to-r2 -- --dry-run
npm run update-photo-urls -- --dry-run

# 3. Se dry-runs forem bem-sucedidos, é seguro fazer de verdade
npm run migrate:photos-to-r2
npm run migrate:avatars-to-r2
npm run update-photo-urls
npm run validate:migration

# 4. Veja site funcionando
npm run dev  # e acesse localhost:3001

# 5. Se algo quebrar, restore:
psql < backup-pre-migration.sql
```

---

## Resumo: Por Que É Seguro

| Passo | Por quê não quebra |
|---|---|
| 1. Upload para R2 | Supabase intacto, site funciona |
| 2. Atualizar URLs | Aponta para R2, que já tem arquivos |
| 3. Validar | Garante URLs corretas antes de deletar |
| 4. Deletar Supabase | R2 já é fonte de verdade |

**TL;DR:** Task 8 (validação) é A chave. Se passar, você está seguro.
