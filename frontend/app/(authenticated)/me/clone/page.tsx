// Фаза 3 ТЗ Clones=Roles: клоны теперь ролевые, /me/clone → редирект на /clones.
import { redirect } from 'next/navigation';

export default function MyClonePage() {
  redirect('/clones');
}
