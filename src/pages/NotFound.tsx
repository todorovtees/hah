import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-surface text-center text-gray-300">
      <h1 className="text-2xl font-semibold text-white">Страницата не е намерена</h1>
      <Link to="/" className="btn-primary">
        Обратно към HAH
      </Link>
    </div>
  );
}
