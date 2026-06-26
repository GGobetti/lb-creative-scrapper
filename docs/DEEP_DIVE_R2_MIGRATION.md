# Deep Dive: Migração de Fotos para Cloudflare R2

## O Problema Atual

### Limite de Egress (Banda de Download)

O projeto está excedendo o limite de egress do Supabase:

```
Egress: 5.132 / 5 GB (103%) ❌
Cached Egress: 4.184 / 5 GB (84%)
```

**O que é Egress?**
- Dados que saem do servidor (downloads de fotos)
- Quando um usuário acessa o site, o navegador faz requisição às URLs das fotos
- Cada download consome egress

**Exemplo:**
- 1.376 fotos ativas × ~116 KB média = ~159 MB de dados
- Se cada foto é visualizada ~20x por mês = ~3.2 GB de egress
- + bots, crawlers, embeds em redes sociais = fácil atingir 5+ GB/mês

**No Supabase Storage (Free Tier):**
- Storage: 1 GB (temos 236 MB — OK)
- Egress: 2 GB/mês (excedemos em 103%)
- Quando passa do limite = bloqueado ou cobrado

---

## A Solução: Cloudflare R2

### Por que R2?

| Característica | Supabase Storage | Cloudflare R2 |
|---|---|---|
| **Limite de Egress** | 2 GB/mês | Ilimitado ∞ |
| **Preço Egress** | Bloqueado no free tier | Grátis |
| **Armazenamento** | 1 GB | 10 GB |
| **Preço armazenamento** | Grátis | Grátis (até 10 GB) |
| **CDN** | Sim | Sim (com Cloudflare) |
| **S3 Compatible** | Não | Sim (AWS SDK funciona) |

**Vencedor:** R2 é perfeito para este projeto.

### Infraestrutura Atual

O código **já usa R2** para arquivos STL:

```typescript
// src/scraper/core.ts
if (isR2Configured()) {
  r2ObjectKey = `stl/${fileHash}.${ext}`;
  await uploadToR2(r2ObjectKey, mediaData, fileName);
}
```

**Problema:** Fotos ainda estão em Supabase Storage.

---

## Plano da Migração

### Fase 1: Preparação

1. **Validar credenciais R2** — confirmar que AWS SDK está configurado
2. **Criar funções genéricas** — `uploadPhotoToR2()`, `deletePhotoFromR2()`, etc
3. **Adicionar testes** — garantir que o upload funciona

### Fase 2: Migração de Fotos Existentes

4. **Backfill** — copiar 1.376 fotos de Supabase → R2
5. **Atualizar banco** — trocar URLs no banco de Supabase → R2
6. **Validar** — testar que site continua funcionando

### Fase 3: Novas Fotos

7. **Modificar scraper** — fazer upload de novas fotos em R2 ao invés de Supabase
8. **Limpar Supabase** — deletar fotos antigas (opcional, mas recomendado)

### Fase 4: Documentação

9. **Documentar processo** — para referência futura

---

## Mudanças de URL

### Antes (Supabase Storage)

```
https://yruoiwtnxopcbiiuvxxa.supabase.co/storage/v1/object/public/portfolio/telegram/photo_1781726163753_7.jpg
```

### Depois (Cloudflare R2)

```
https://<account-id>.r2.cloudflarestorage.com/photos/photo_1781726163753_7.jpg
```

**Ou com domínio customizado (opcional):**

```
https://images.seu-dominio.com/photos/photo_1781726163753_7.jpg
```

---

## Impacto no Código

### Novos Arquivos

```
src/lib/r2-photos.ts          ← Funções para fotos em R2
scripts/migrate-photos-to-r2.ts ← Backfill
scripts/update-photo-urls-in-db.ts ← Atualizar URLs no banco
scripts/cleanup-supabase-photos.ts ← Limpeza final
tests/lib/r2-photos.test.ts   ← Testes
```

### Arquivos Modificados

```
src/scraper/core.ts  ← Mudar upload de Supabase para R2 (linhas ~348-365)
package.json        ← Adicionar scripts npm
```

---

## Benefícios Esperados

### Antes
- ❌ Bloqueado em egress (5 GB > 2 GB free tier)
- ❌ Storage ocupando 236 MB do free tier
- ❌ Scraper e site usando serviços diferentes (STL em R2, fotos em Supabase)

### Depois
- ✅ Sem limite de egress (R2 ilimitado)
- ✅ Storage centralizado em R2 (10 GB grátis)
- ✅ Scraper e site usando uma única infraestrutura (tudo em R2)
- ✅ Reduz dependência do Supabase Storage
- ✅ Mais escalável e barato no futuro

---

## Cronograma Recomendado

1. **Task 1-2** (Prep): ~30 min
   - Validar R2
   - Criar funções + testes

2. **Task 3** (Backfill): ~30 min
   - Criar e testar script de migração
   - Executar migrate (takes ~5-10 min para 1.376 fotos)

3. **Task 4-5** (Update): ~20 min
   - Atualizar scraper
   - Atualizar URLs no banco

4. **Task 6-7** (Cleanup): ~10 min
   - Limpar Supabase
   - Documentar

**Total: ~1.5-2 horas de trabalho**

---

## Checklist de Validação

Após cada fase, validar:

- [ ] Script de backfill roda em dry-run sem erro
- [ ] Fotos são uploadadas para R2 com sucesso
- [ ] URLs no banco são atualizadas corretamente
- [ ] Site carrega fotos normalmente (testar em navegador)
- [ ] Novas fotos do scraper vão para R2 (não Supabase)
- [ ] Supabase Storage está vazio ou quase vazio

---

## Rollback Plan (se der ruim)

Se algo der errado durante a migração:

1. **Fotos Supabase não foram deletadas** → ainda tem cópia lá
2. **URLs no banco ainda apontam para Supabase** → revert o script de update
3. **Scraper tentando upload em R2 mas credenciais erradas** → reverte para Supabase no código

Basicamente, a migração é **reversível** até o passo final (cleanup).

---

## Próximos Passos

1. Revisar este documento com o time
2. Iniciar Task 1 (validação de credenciais)
3. Executar tasks em sequência
4. Validar cada fase antes de prosseguir

Plano completo: [docs/superpowers/plans/2026-06-25-migrate-photos-r2.md](./superpowers/plans/2026-06-25-migrate-photos-r2.md)
