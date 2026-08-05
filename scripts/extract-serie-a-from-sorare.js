// scripts/extract-serie-a-from-sorare.js
// Estrae TUTTI i giocatori di Serie A da Sorare, squadra per squadra
// Usage: node scripts/extract-serie-a-from-sorare.js

import fs from 'fs';
import path from 'path';

const SORARE_API = 'https://api.sorare.com/graphql';
const OUTPUT_CSV = path.resolve('data/sorare_serie_a_players.csv');
const DELAY_MS = 2500; // 2.5 secondi tra ogni richiesta

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Squadre Serie A 2026/27
const SERIE_A_TEAMS = [
  'Atalanta', 'Bologna', 'Cagliari', 'Como',
  'Fiorentina', 'Frosinone', 'Genoa', 'Inter',
  'Juventus', 'Lazio', 'Lecce', 'Milan',
  'Monza', 'Napoli', 'Parma', 'Roma',
  'Sassuolo', 'Torino', 'Udinese', 'Venezia'
];

async function searchTeamPlayers(teamName, page = 0) {
  const query = `
    query SearchTeam($query: String!, $page: Int!, $pageSize: Int!) {
      searchPlayers(query: $query, page: $page, pageSize: $pageSize) {
        hits {
          player {
            slug
            displayName
            firstName
            lastName
            activeClub { 
              name
              domesticLeague { slug }
            }
            country { threeLetterCode name }
            age
            position
          }
        }
        nbHits
        nbPages
      }
    }
  `;

  try {
    const res = await fetch(SORARE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { query: teamName, page, pageSize: 50 }
      }),
    });

    if (!res.ok) {
      console.error(`  HTTP ${res.status} for "${teamName}" page ${page}`);
      return { players: [], nbPages: 0 };
    }

    const data = await res.json();
    if (data.errors) {
      console.error(`  GraphQL error for "${teamName}":`, data.errors[0].message);
      return { players: [], nbPages: 0 };
    }

    const result = data.data?.searchPlayers;
    const players = (result?.hits || [])
      .map(h => h.player)
      .filter(Boolean);

    return {
      players,
      nbPages: result?.nbPages || 0,
      nbHits: result?.nbHits || 0
    };
  } catch (err) {
    console.error(`  Fetch error for "${teamName}":`, err.message);
    return { players: [], nbPages: 0 };
  }
}

function isSerieATeam(player, targetTeam) {
  const club = player.activeClub;
  if (!club) return false;
  
  const clubName = (club.name || '').toLowerCase();
  const target = targetTeam.toLowerCase();
  const leagueSlug = (club.domesticLeague?.slug || '').toLowerCase();
  
  // Verifica che sia in Serie A
  const isSerieA = leagueSlug.includes('serie-a') || leagueSlug.includes('serie_a');
  
  // Verifica che il club corrisponda alla squadra cercata
  const clubMatch = clubName.includes(target) || target.includes(clubName.split(' ')[0]);
  
  return isSerieA && clubMatch;
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.log('Estrazione giocatori Serie A da Sorare...\n');
  
  const allPlayers = new Map(); // slug -> player data (dedup)

  for (const team of SERIE_A_TEAMS) {
    console.log(`\n🏟️  ${team}...`);
    
    // Prima pagina
    const first = await searchTeamPlayers(team, 1);
    const teamPlayers = first.players.filter(p => isSerieATeam(p, team));
    
    console.log(`  Pagina 1: ${first.players.length} risultati, ${teamPlayers.length} di ${team} in Serie A`);
    
    teamPlayers.forEach(p => {
      if (!allPlayers.has(p.slug)) {
        allPlayers.set(p.slug, { ...p, matchedTeam: team });
      }
    });

    await sleep(DELAY_MS);

    // Se ci sono più pagine, proviamo pagina 2
    if (first.nbPages > 1) {
      const second = await searchTeamPlayers(team, 2);
      const morePlayers = second.players.filter(p => isSerieATeam(p, team));
      console.log(`  Pagina 2: ${second.players.length} risultati, ${morePlayers.length} di ${team}`);
      
      morePlayers.forEach(p => {
        if (!allPlayers.has(p.slug)) {
          allPlayers.set(p.slug, { ...p, matchedTeam: team });
        }
      });

      await sleep(DELAY_MS);
    }
  }

  // Genera CSV
  const headers = [
    'sorare_slug', 'display_name', 'first_name', 'last_name',
    'sorare_club', 'our_team', 'league', 'country', 'age', 'position'
  ];

  const rows = [headers.join(',')];
  
  // Ordina per squadra poi per nome
  const sorted = [...allPlayers.values()].sort((a, b) => {
    const teamCmp = a.matchedTeam.localeCompare(b.matchedTeam);
    if (teamCmp !== 0) return teamCmp;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  for (const p of sorted) {
    rows.push([
      escapeCSV(p.slug),
      escapeCSV(p.displayName),
      escapeCSV(p.firstName),
      escapeCSV(p.lastName),
      escapeCSV(p.activeClub?.name),
      escapeCSV(p.matchedTeam),
      escapeCSV(p.activeClub?.domesticLeague?.slug),
      escapeCSV(p.country?.threeLetterCode),
      escapeCSV(p.age),
      escapeCSV(p.position),
    ].join(','));
  }

  fs.writeFileSync(OUTPUT_CSV, rows.join('\n'), 'utf-8');

  // Report per squadra
  console.log(`\n========================================`);
  console.log(`REPORT`);
  console.log(`========================================`);
  
  const byTeam = {};
  for (const p of sorted) {
    byTeam[p.matchedTeam] = (byTeam[p.matchedTeam] || 0) + 1;
  }
  
  for (const team of SERIE_A_TEAMS) {
    const count = byTeam[team] || 0;
    const icon = count >= 20 ? '✅' : count >= 10 ? '⚠️' : '❌';
    console.log(`  ${icon} ${team}: ${count} giocatori`);
  }

  console.log(`\nTOTALE: ${allPlayers.size} giocatori unici`);
  console.log(`Salvato in: ${OUTPUT_CSV}`);
  console.log(`\nProssimo step: incrociare con il listone fantacalcio.it per ruoli e prezzi.`);
}

main().catch(console.error);
