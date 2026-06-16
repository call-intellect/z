import { redirect } from 'next/navigation';

export default function PoliciesPage() {
  redirect('/regulations?kind=policy');
}
