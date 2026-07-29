# Fantastats — Game Design Document

> Documento di riferimento con tutte le decisioni prese durante il brainstorming.
> Ultima revisione: 28 luglio 2026

---

## 1. Visione del progetto

**Fantastats** è un fantacalcio personalizzato basato interamente su statistiche live. Niente voti dei quotidiani — il punteggio di ogni giocatore è calcolato in tempo reale durante la partita a partire dai dati statistici reali.

Progetto tra amici, non commerciale. Stack interamente gratuito.

---

## 2. Fonte dati

- **API**: Sorare GraphQL API
- **Endpoint**: `https://api.sorare.com/graphql`
- **Autenticazione**: nessuna per le query in lettura (dati pubblici)
- **Copertura**: statistiche aggiornate in tempo reale durante le partite (campo `live` in `PlayerGameStats`)
- **FBref**: valutato e scartato — non offre dati live, aggiornamento solo post-partita, nessuna API ufficiale, rate limit di 1 richiesta ogni 3 secondi

---

## 3. Stack tecnico

| Componente | Tecnologia | Costo |
|---|---|---|
| Frontend | React + Vite | Gratuito (open source) |
| Hosting frontend | Vercel free tier | Gratuito |
| Database | Supabase (PostgreSQL) free tier | Gratuito (500MB, auth illimitata) |
| Backend / Cron | Supabase Edge Functions | Gratuito (500k invocazioni/mese) |
| Polling Sorare | Edge Function schedulata con cron | Gratuito |
| Real-time updates | Supabase Realtime (subscriptions) | Incluso nel free tier |

---

## 4. Struttura della piattaforma

La piattaforma si divide in due sezioni:

### 4.1 Leghe personalizzate

- L'**admin** (scelto dal gruppo di amici) crea e configura la lega
- Rosa fissa a inizio anno + mercato di riparazione
- Formazione da **7 o da 11** (settabile dall'admin)
- Rosa da **18 giocatori** (formazione da 7) o **25-28** (formazione da 11, sistema Mantra)
- Minimo **2 portieri** in rosa
- Minimo **6 partecipanti**, nessun tetto massimo

### 4.2 Categorie predefinite

- Giocabili senza gruppo di amici
- Solo formazione da **7**
- **Unica rosa condivisa** tra tutte le categorie, senza limite di dimensione
- Crediti iniziali sufficienti per partecipare a **2-3 categorie**
- Ogni giocatore schierabile in **una sola categoria** per giornata
- Niente doppioni nella propria rosa (ma utenti diversi possono avere lo stesso giocatore)
- Nessun limite agli svincoli
- Mercato sempre aperto, budget a crediti stagionali
- **Premi settimanali** in base al posizionamento: giocatori, crediti o entrambi
- I giocatori vinti si possono svincolare al valore corrente
- Progressione: si amplia la rosa per partecipare a più categorie
- **Classifica per giornata**: ogni game week è una competizione indipendente
- **Classifica stagionale finale**: solo per chi ha giocato tutte le giornate disponibili in una categoria

---

## 5. Categorie predefinite

### Categorie fisse (6)

| Nome | Pool | Regola |
|---|---|---|
| **Sorprese** | Ultime 10 in classifica Serie A | Pool si aggiorna a ogni giornata |
| **Elite** | Prime 10 in classifica Serie A | Pool si aggiorna a ogni giornata |
| **7 Sorelle** | Inter, Milan, Juventus, Roma, Lazio, Fiorentina, Parma | Pool fisso per tutta la stagione |
| **Top Performers** | Giocatori con punteggio medio nelle ultime 5 giornate sopra soglia | Pool si aggiorna a ogni giornata |
| **Under 23** | Solo giocatori nati dal 2003 in poi | Pool fisso per stagione |
| **Italians do it better** | Tutti i giocatori di Serie A | Almeno 9 italiani su 18 in rosa + almeno 4 italiani su 7 titolari |

### Categoria a evento (1)

| Nome | Pool | Regola |
|---|---|---|
| **Hype** | Solo giocatori delle squadre coinvolte nei big match/derby della giornata | Lanciata ad hoc, non ogni giornata |

---

## 6. Ruoli e formazioni

### 6.1 Formazione da 7: 1 POR + 3 DEF + 3 OFF

#### Ruoli

| Ruolo | Abbreviazione | Slot | Vincoli |
|---|---|---|---|
| Portiere | POR | — | Punteggio dedicato, nessun moltiplicatore |
| Difensore centrale | DC | Difensivo | Max 2 per formazione |
| Terzino | T | Difensivo | Destro o sinistro, unificati |
| Centrocampista centrale | C | Difensivo | Esattamente 1 per formazione (obbligatorio) |
| Esterno d'attacco | ES | Offensivo | — |
| Trequartista | Tq | Offensivo | — |
| Attaccante | ATT | Offensivo | Almeno 1, max 2 per formazione |

#### Vincoli formazione

- Esattamente 1 C (obbligatorio)
- Max 2 DC
- Almeno 1 ATT, max 2 ATT

#### 8 Moduli

| # | Slot difensivi | Slot offensivi | Identità tattica |
|---|---|---|---|
| 1 | DC + DC + C | ES + Tq + ATT | Classico equilibrato |
| 2 | DC + DC + C | ES + ES + ATT | Doppio esterno |
| 3 | DC + DC + C | ES + ATT + ATT | Doppia punta, una fascia |
| 4 | DC + DC + C | Tq + ATT + ATT | Doppia punta centrale |
| 5 | DC + T + C | ES + Tq + ATT | Con terzino |
| 6 | DC + T + C | ES + ES + ATT | Terzino + doppie fasce |
| 7 | DC + T + C | ES + ATT + ATT | Terzino + doppia punta |
| 8 | T + T + C | ES + Tq + ATT | Senza centrali, all-in fasce |

### 6.2 Formazione da 11: Sistema Mantra (1 POR + 5 DEF + 5 OFF)

#### Ruoli

| Ruolo | Abbreviazione | Stampo |
|---|---|---|
| Portiere | Por | — |
| Difensore centrale | Dc | Difensivo |
| Terzino destro | Dd | Difensivo |
| Terzino sinistro | Ds | Difensivo |
| Esterno a tutta fascia | E | Difensivo |
| Mediano | M | Difensivo |
| Centrocampista / Mezzala | C | Offensivo |
| Trequartista | T | Offensivo |
| Ala | W | Offensivo |
| Attaccante | A | Offensivo |
| Punta centrale | Pc | Offensivo |

#### 11 Moduli Mantra

| # | Modulo | Distribuzione |
|---|---|---|
| 1 | 3-4-3 | 3 Dc — 2 E/M, 2 C/W — 1 T/A, 2 A/Pc |
| 2 | 3-4-1-2 | 3 Dc — 2 E/M, 2 C — 1 T — 2 A/Pc |
| 3 | 3-4-2-1 | 3 Dc — 2 E/M, 2 C — 2 T/W — 1 A/Pc |
| 4 | 3-5-2 | 3 Dc — 2 E/M, 2 M/C, 1 C/T — 2 A/Pc |
| 5 | 3-5-1-1 | 3 Dc — 2 E/M, 2 M/C, 1 C — 1 T — 1 A/Pc |
| 6 | 4-3-3 | 2 Dc, 2 Dd/Ds — 1 M, 2 C — 2 W, 1 A/Pc |
| 7 | 4-3-1-2 | 2 Dc, 2 Dd/Ds — 1 M, 2 C — 1 T — 2 A/Pc |
| 8 | 4-4-2 | 2 Dc, 2 Dd/Ds — 2 E/M, 2 C/W — 2 A/Pc |
| 9 | 4-1-4-1 | 2 Dc, 2 Dd/Ds — 1 M — 2 C/W, 2 W/T — 1 A/Pc |
| 10 | 4-4-1-1 | 2 Dc, 2 Dd/Ds — 2 E/M, 2 C/W — 1 T — 1 A/Pc |
| 11 | 4-2-3-1 | 2 Dc, 2 Dd/Ds — 2 M/C — 2 W/T, 1 T/C — 1 A/Pc |

---

## 7. Sistema di punteggio

### 7.1 Principi

- **Base additiva**: ogni azione ha un valore fisso, i punti si sommano
- **Moltiplicatore ×1.3**: le azioni "fuori fase" (offensive per chi è in slot difensivo e viceversa) valgono ×1.3, ma **solo per giocatori a ruolo singolo** (non per chi ha doppio ruolo cross-slot)
- **Bonus/malus a soglia**: bonus o penalità una tantum al raggiungimento di determinate soglie
- **Portiere**: sistema dedicato, nessun moltiplicatore
- **Niente capitano**
- Target: giocatore medio ~5-7 punti, buona prestazione ~10-15, prestazione eccezionale 20+

### 7.2 Partecipazione

| Azione | Campo Sorare | Punti |
|---|---|---|
| In campo (qualsiasi minutaggio) | onGameSheet / minsPlayed | +2 |
| 60+ minuti giocati | minsPlayed ≥ 60 | +1 (totale +3) |

### 7.3 Fase offensiva

| Azione | Campo Sorare | Punti | Slot DEF ×1.3 |
|---|---|---|---|
| Gol | goals | +6 | 7.8 |
| Gol su rigore | attPenGoal | +4 | 5.2 |
| Assist | goalAssist | +3 | 3.9 |
| Tiro in porta | ontargetScoringAtt | +0.5 | 0.65 |
| Big chance creata | bigChanceCreated | +1.5 | 1.95 |
| Rigore procurato | assistPenaltyWon | +1.5 | 1.95 |
| Rigore sbagliato | attPenMiss | -3 | — |

> Gol su rigore: vale +4, NON si somma al +6 del gol generico.

### 7.4 Fase di costruzione

| Azione | Campo Sorare | Punti |
|---|---|---|
| Passaggio riuscito | accuratePass | +0.03 |

> 50 passaggi riusciti = 1.5 pt. 15 passaggi = 0.45 pt.

### 7.5 Fase difensiva

| Azione | Campo Sorare | Punti | Slot OFF ×1.3 |
|---|---|---|---|
| Tackle vinto | wonTackle | +0.4 | 0.52 |
| Intercetto | interceptionWon | +0.4 | 0.52 |
| Respinta efficace | effectiveClearance | +0.3 | 0.39 |
| Duello vinto | duelWon | +0.15 | 0.20 |
| Salvataggio sulla linea | clearanceOffLine | +3 | 3.9 |
| Intervento da ultimo uomo | lastManTackle | +3 | 3.9 |

### 7.6 Portiere

| Azione | Campo Sorare | Punti |
|---|---|---|
| Parata | saves | +0.5 |
| Rigore parato | penaltySave | +5 |
| Gol subito | goalsConceded | -1 |

### 7.7 Disciplina e errori

| Azione | Campo Sorare | Punti |
|---|---|---|
| Fallo commesso | fouls | -0.2 |
| Cartellino giallo | yellowCard | -1 |
| Doppio giallo / espulsione | redCard (da 2° giallo) | -3 |
| Rosso diretto | redCard (diretto) | -4 |
| Autogol | ownGoals | -4 |
| Errore che porta a gol | errorLeadToGoal | -3 |
| Errore che porta a tiro | errorLeadToShot | -1 |
| Rigore causato | penaltyConceded | -2 |

### 7.8 Bonus milestone (una tantum a partita)

| Bonus | Condizione | Punti | ×1.3 |
|---|---|---|---|
| Clean sheet portiere | cleanSheet (POR, 60+ min) | +4 | — |
| Clean sheet difensore | cleanSheet (slot DEF, 60+ min) | +3 | — |
| 4+ dribbling riusciti | wonContest ≥ 4 | +2 | 2.6 (slot DEF) |
| 3+ big chance create | bigChanceCreated ≥ 3 | +2 | 2.6 (slot DEF) |
| 85%+ pass accuracy (30+ pass) | passAccuracy ≥ 85 & totalPass ≥ 30 | +1.5 | — |

### 7.9 Malus milestone (una tantum a partita)

| Malus | Condizione | Punti |
|---|---|---|
| 3+ gol subiti (portiere) | threeGoalsConceded | -3 |
| 5+ falli commessi | fouls ≥ 5 | -1.5 |
| 0 tackle vinti su 3+ tentati | wonTackle = 0 & totalTackle ≥ 3 | -1 |

### 7.10 Moltiplicatore ×1.3 — regole

- Si applica **solo** a giocatori con un unico ruolo (non cross-slot)
- Slot difensivo → azioni offensive (gol, assist, tiri, chance create) valgono ×1.3
- Slot offensivo → azioni difensive (tackle, intercetti, respinte, duelli, salvataggi) valgono ×1.3
- Il portiere **non** ha moltiplicatore
- Esempio: un DC puro che segna = 6 × 1.3 = 7.8 pt. Un T/ES (doppio ruolo cross-slot) che segna = 6 pt

### 7.11 Dati non disponibili su Sorare

Le seguenti statistiche non sono tracciate dall'API Sorare e quindi non sono incluse nel sistema:

- Dribbling subiti (essere saltato)
- Palle perse
- Cross riusciti vs tentati (solo percentuale, senza volume)
- Distinzione fallo subito in area vs altri tipi di rigore procurato
- Palo/traversa su tiro (disponibile solo per rigori tramite attPenPost)

---

## 8. Mercato

### 8.1 Categorie predefinite

- **Budget**: crediti stagionali (non si resettano ogni settimana)
- **Algoritmo pricing**: basato sul rendimento nelle ultime 5 giornate (no scarsità del pool)
- **Nessun limite** agli svincoli
- **Mercato sempre aperto**: il pool cambia di giornata in giornata (tranne 7 Sorelle e Under 23 che hanno pool fisso)
- Due utenti possono avere lo stesso giocatore
- **Premi settimanali**: giocatori, crediti o entrambi in base al posizionamento

### 8.2 Leghe personalizzate

Due opzioni a scelta dell'admin:

**Asta in presenza**
- L'admin gestisce l'asta dalla piattaforma
- Gli altri partecipanti accedono a una pagina in sola lettura tramite codice univoco
- Opzione asta classica o busta chiusa

**Mercato a crediti**
- Stesso sistema delle categorie predefinite
- Rosa fissa, i giocatori sono esclusivi (un giocatore può essere di un solo utente)

**Pricing giocatori svincolati** (mercato di riparazione):
- Prezzo base: preso da fantacalcio.it a inizio stagione (scrape una tantum)
- Aggiustato per: scarsità di ruolo nel momento + rendimento del giocatore

---

## 9. Competizioni

### 9.1 Categorie predefinite

- **Classifica per giornata**: ogni game week è una competizione indipendente, chi fa più punti vince
- **Classifica stagionale finale**: solo per chi ha giocato tutte le giornate disponibili in una categoria

### 9.2 Leghe personalizzate

L'admin sceglie tra 4 formati:

| Formato | Meccanismo | Classifica |
|---|---|---|
| Scontri diretti + Serie A | Avversario singolo ogni giornata | 3 vittoria, 1 pareggio, 0 sconfitta |
| Scontri diretti + Somma voti | Avversario singolo ogni giornata | Classifica per punteggio totale |
| Royal rumble + Serie A | Confronto vs tutti ogni giornata | 3-1-0 per ogni confronto, sommati |
| Royal rumble + Formula 1 | Confronto vs tutti ogni giornata | Punti posizione per classifica di giornata |

> **Royal rumble**: ogni giornata il tuo punteggio viene confrontato con quello di TUTTI gli altri partecipanti. Per ogni confronto: vittoria 3 pt, pareggio 1 pt, sconfitta 0 pt.

**Scontri diretti — calendario**: girone all'italiana andata e ritorno. Il sistema calcola automaticamente quanti cicli completi entrano nelle giornate di Serie A rimanenti.

Formula: (giornate rimanenti) ÷ ((partecipanti - 1) × 2) = numero cicli, arrotondato per difetto.

**Spareggio** a fine stagione in caso di parità: somma voti totale.

---

## 10. Regole di gioco

### 10.1 Sostituzioni

- Automatiche, **ruolo su ruolo**
- Se non c'è un sostituto compatibile col modulo, il sistema **cambia modulo** automaticamente pur di non giocare con meno giocatori
- Priorità: numero giocatori in campo > mantenimento modulo
- L'utente ordina i riserve in panchina per priorità di ingresso

### 10.2 Deadline formazione

- Default: **15 minuti prima della prima partita** della giornata
- Personalizzabile dall'admin nelle leghe

### 10.3 Partite rinviate

- Se la partita viene rinviata oltre la conclusione della game week: **6 politico** (o sufficienza calibrata sui punteggi medi del sistema) a tutti i giocatori tranne infortunati e squalificati
- Vale sia per le leghe che per le categorie predefinite

### 10.4 Consolidamento punteggio

- Il punteggio della giornata si consolida il **martedì mattina**

### 10.5 Partecipanti

- Minimo **6** per le leghe personalizzate
- Nessun tetto massimo

---

## 11. Da definire

- [ ] Frequenza polling Sorare durante le partite live
- [ ] Mapping giocatori Sorare → ruoli del nostro sistema (da 11 ruoli Mantra + 6 ruoli formazione da 7)
- [ ] Gestione multipartita (partite che iniziano a orari diversi)
- [ ] Calibrazione soglie bonus/malus con dati reali
- [ ] Valore base dei giocatori a inizio stagione per le categorie
- [ ] Scala punti Formula 1 (25-18-15-12... o personalizzabile?)
- [ ] Studio statistico per validare i pesi delle azioni
- [ ] Struttura premi settimanali categorie (quanti crediti, quali giocatori, per quali posizioni)
- [ ] Soglia punteggio per la categoria Top Performers
