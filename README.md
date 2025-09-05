
# App de Lançamentos de Produção – Mineração (Vite + React + Tailwind + Supabase)

Este projeto permite lançar e acompanhar a produção diária de **Britagem** e **Moagem**, com **modo offline** e **sincronização** via Supabase.

## 1) Pré‑requisitos
- **Node.js** (versão LTS 18+ ou 20+): https://nodejs.org
- (Opcional) **Git**: https://git-scm.com

## 2) Baixe e abra o projeto
1. Descompacte o zip.
2. Abra o **Prompt de Comando** (Windows) ou **Terminal** (Mac/Linux).
3. Navegue até a pasta do projeto. Ex.:

```bash
cd prado-mineracao-producao
```

4. Instale as dependências:

```bash
npm install
```

## 3) Crie o projeto no Supabase
1. Acesse https://supabase.com e crie um projeto (grátis).
2. Vá em **Database → SQL** e cole o conteúdo de `supabase.sql` (dentro desta pasta). Clique em **Run**.
3. Em **Authentication → Providers**, habilite **Email** (magic link/OTP).
4. Em **Project Settings → API**, copie:
   - **Project URL**
   - **anon public** key

## 4) Configure as variáveis de ambiente
1. Faça uma cópia do arquivo `.env.example` com o nome `.env` e preencha:
```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...sua_chave_anon...
```
2. Salve o arquivo `.env`.

## 5) Rodar localmente (PC)
```bash
npm run dev
```
- Abra o endereço que aparecer (geralmente http://localhost:5173).
- Digite seu e-mail e clique **Entrar por e-mail** (você receberá um link).
- Lance a produção. Sem internet? Os dados ficam locais e podem ser sincronizados depois.

## 6) Deploy (publicar para usar no PC e celular)
### Opção A – Vercel (recomendada)
1. Crie uma conta em https://vercel.com
2. (Com Git instalado) inicialize um repositório e suba para o GitHub:
   ```bash
   git init
   git add .
   git commit -m "primeira versão"
   git branch -M main
   # crie um repo no GitHub e substitua a URL abaixo
   git remote add origin https://github.com/SEU-USUARIO/prado-mineracao-producao.git
   git push -u origin main
   ```
3. Na Vercel, clique **Add New → Project**, importe o repositório.
4. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Pronto! Você terá uma URL pública. Abra no celular e no PC.

### Opção B – Vercel CLI (sem GitHub)
1. Instale a CLI:
   ```bash
   npm i -g vercel
   ```
2. Rode:
   ```bash
   vercel
   ```
   Siga o passo a passo e, na Vercel, defina as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

## 7) Como usar (resumo)
- **Novo Lançamento:** preencha Data, Turno, Início/Fim, Etapa (Britagem/Moagem), Equipamento, Toneladas etc. e clique **Adicionar**.
- **KPIs:** veja totais por filtro, hoje e no mês.
- **Gráfico:** produção por dia Britagem × Moagem.
- **CSV/Backup:** exporte CSV, faça backup/importação JSON.
- **Sincronizar:** envia/baixa dados da nuvem quando logado.

## 8) Observações
- O app é *offline-first*: sem internet, grava localmente e coloca na fila. Depois, clique **Sincronizar**.
- Para escanear QR ou tirar fotos do painel de balança, dá para adicionar em versões futuras.

Bom uso! 🚀
