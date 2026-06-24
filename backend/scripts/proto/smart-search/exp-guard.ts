import { LoopGuard, fingerprint } from './loop-guard';

let pass = 0;
let total = 0;
function check(name: string, cond: boolean): void {
  total++;
  if (cond) pass++;
  process.stdout.write(`${cond ? '✅' : '❌'} ${name}\n`);
}

const g = new LoopGuard();
check('первый запрос пропущен', g.firstTime('встреча Александр') === true);
check('тот же запрос заблокирован', g.firstTime('встреча Александр') === false);
check('тот же запрос с другим регистром/пунктуацией — тоже заблокирован', g.firstTime('Встреча, Александр!') === false);
check('другой запрос пропущен', g.firstTime('боли Александра') === true);
check('счётчик срабатываний = 2', g.hitCount === 2);
check('отпечаток нормализует регистр/пунктуацию', fingerprint('Встреча, Александр!') === fingerprint('встреча александр'));

process.stdout.write(`\nСторож зацикливания: ${pass}/${total}\n`);
process.exit(pass === total ? 0 : 1);
