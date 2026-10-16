import { useEffect, useState } from 'react';
import { chatApi } from '../../api/chat';
import { ApiError } from '../../api/client';
import type { Chat, ChatInfo } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { formatSize } from '../../components/chat/attachments';
import BrandLoader from '../../components/ui/BrandLoader';

/** A chat's numbers: messages, tokens, models, dates and the files in its folder. */
const ChatInfoDialog = ({ chat, onClose }: { chat: Chat; onClose: () => void }) => {
  const { t, language } = useI18n();
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    chatApi
      .info(chat.id)
      .then(setInfo)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common.networkError')));
  }, [chat.id, t]);

  const number = (n: number) => n.toLocaleString(language);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) : '-');

  const rows: [string, string][] = info
    ? [
        [t('chat.infoTokens'), `${number(info.tokens_in + info.tokens_out)} (${t('chat.infoTokensSplit', { in: number(info.tokens_in), out: number(info.tokens_out) })})`],
        [t('chat.infoMessages'), t('chat.infoMessagesCount', { sent: number(info.messages), answers: number(info.answers) })],
        [t('chat.infoModels'), info.models.length ? info.models.join(', ') : '-'],
        [t('chat.infoFiles'), t('chat.infoFilesCount', { count: number(info.files.count), size: formatSize(info.files.bytes) })],
        [t('chat.infoFolder'), info.folder],
        [t('chat.infoCreated'), date(info.created_at)],
        [t('chat.infoLastAnswer'), date(info.last_answer_at)],
      ]
    : [];

  return (
    <Modal title={chat.title || t('chat.new')} onClose={onClose}>
      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !info ? (
        <div className="flex justify-center py-2"><BrandLoader size={36} /></div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
};

export default ChatInfoDialog;
