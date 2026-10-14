import { Check } from 'lucide-react';

/** Brief confirmation pinned to the bottom of the viewport. */
const Toast = ({ message }: { message: string }) => (
  <div role="status" aria-live="polite" className="animate-toast-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
    <div className="flex items-center gap-2.5 rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg dark:bg-slate-700">
      <Check size={17} className="text-emerald-400" aria-hidden="true" />
      {message}
    </div>
  </div>
);

export default Toast;
