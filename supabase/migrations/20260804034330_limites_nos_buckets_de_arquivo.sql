-- Dos 7 buckets, so `avatars` tinha limite. Os outros 6 aceitavam arquivo de
-- QUALQUER tamanho e QUALQUER tipo, e as policies de storage so exigiam ser membro
-- da empresa. Um funcionario podia encher o armazenamento, ou hospedar um
-- executavel numa URL do dominio.
--
-- O limite do bucket e imposto pelo proprio Storage, entao vale mesmo que alguem
-- chame a API direto, sem passar pelo app. E a camada que conta; a validacao no
-- servidor (src/lib/uploads.ts) e para a mensagem de erro sair em portugues.
--
-- meeting-audio usa 25 MB para casar com o bodySizeLimit das Server Actions do
-- Next, que e por onde o audio sobe.

update storage.buckets set
  file_size_limit = 10485760,  -- 10 MB
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic',
    'application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv'
  ]
where id in ('ticket-attachments','feedback-attachments','action-attachments','agenda-attachments');

update storage.buckets set
  file_size_limit = 5242880,   -- 5 MB: foto de checklist vem de camera de celular
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
where id = 'checklist-photos';

update storage.buckets set
  file_size_limit = 26214400,  -- 25 MB, ~70 min a 48 kbps
  allowed_mime_types = array[
    'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-m4a','audio/aac','video/webm'
  ]
where id = 'meeting-audio';
