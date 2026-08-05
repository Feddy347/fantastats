// scripts/lookup-unmapped-sorare.js
// Cerca ogni giocatore non mappato su Sorare e genera un CSV con i candidati reali
// Usage: node scripts/lookup-unmapped-sorare.js

import fs from 'fs';
import path from 'path';

const SORARE_API = 'https://api.sorare.com/graphql';
const INPUT_CSV = path.resolve('data/unmapped_players.csv');
const OUTPUT_CSV = path.resolve('data/unmapped_with_candidates.csv');
const DELAY_MS = 2000; // 2 secondi tra ogni richiesta

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchSorare(playerName) {
  const query = `
    query SearchPlayer($query: String!) {
      searchPlayers(query: $query, pageSize: 5) {
        hits {
          player {
            slug
            displayName
            activeClub { name }
            country { threeLetterCode }
            age
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(SORARE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { query: playerName } }),
    });

    if (!res.ok) {
      console.error(`  HTTP ${res.status} for "${playerName}"`);
      return [];
    }

    const data = await res.json();
    if (data.errors) {
      console.error(`  GraphQL error for "${playerName}":`, data.errors[0].message);
      return [];
    }

    return (data.data?.searchPlayers?.hits || []).map(h => h.player).filter(Boolean);
  } catch (err) {
    console.error(`  Fetch error for "${playerName}":`, err.message);
    return [];
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1)
    .filter(line => line.trim() && !line.startsWith('player_id,'))
    .map(line => {
      const values = line.split(',');
      const obj = {};
      headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
      return obj;
    });
}

async function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`File non trovato: ${INPUT_CSV}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_CSV, 'utf-8');
  const players = parseCSV(raw);
  console.log(`Trovati ${players.length} giocatori non mappati.\n`);

  // Header CSV output
  const outHeaders = [
    'player_id', 'player_name', 'player_team',
    'c1_slug', 'c1_name', 'c1_club', 'c1_country', 'c1_age',
    'c2_slug', 'c2_name', 'c2_club', 'c2_country', 'c2_age',
    'c3_slug', 'c3_name', 'c3_club', 'c3_country', 'c3_age',
    'selected_slug'
  ];

  const rows = [outHeaders.join(',')];
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    console.log(`[${i + 1}/${players.length}] Cerco: ${p.player_name} (${p.player_team})...`);

    const candidates = await searchSorare(p.player_name);

    const row = [
      p.player_id,
      `"${p.player_name}"`,
      `"${p.player_team}"`,
    ];

    // Riempi fino a 3 candidati
    for (let c = 0; c < 3; c++) {
      if (candidates[c]) {
        row.push(
          `"${candidates[c].slug || ''}"`,
          `"${candidates[c].displayName || ''}"`,
          `"${candidates[c].activeClub?.name || ''}"`,
          `"${candidates[c].country?.threeLetterCode || ''}"`,
          `${candidates[c].age || ''}`
        );
      } else {
        row.push('', '', '', '', '');
      }
    }

    // Colonna selected_slug: auto-compila se il primo candidato matcha la squadra
    let autoSlug = '';
    if (candidates.length > 0) {
      // Prova a fare match automatico sulla squadra
      const teamLower = (p.player_team || '').toLowerCase();
      const match = candidates.find(c => {
        const clubLower = (c.activeClub?.name || '').toLowerCase();
        return clubLower.includes(teamLower) || teamLower.includes(clubLower.split(' ')[0]);
      });
      if (match) {
        autoSlug = match.slug;
        found++;
      } else {
        notFound++;
      }
    } else {
      notFound++;
    }

    row.push(autoSlug ? `"${autoSlug}"` : '');
    rows.push(row.join(','));

    // Rate limit
    if (i < players.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  fs.writeFileSync(OUTPUT_CSV, rows.join('\n'), 'utf-8');

  console.log(`\n========================================`);
  console.log(`Completato!`);
  console.log(`Auto-mappati (squadra match): ${found}`);
  console.log(`Da disambiguare manualmente: ${notFound}`);
  console.log(`Salvato in: ${OUTPUT_CSV}`);
  console.log(`========================================`);
  console.log(`\nApri il CSV, verifica gli auto-mappati e compila selected_slug per quelli mancanti.`);
}

main().catch(console.error);
