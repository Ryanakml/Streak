**Gambaran Besar**

App ini adalah habit tracker dengan dua mode interaksi utama: `Dashboard/Home` untuk aksi cepat dan `Chat` untuk interaksi yang lebih “bercerita”. Tujuan produknya bukan sekadar mencatat habit, tapi memberi tekanan, konteks, dan accountability supaya user benar-benar konsisten.

Secara mental model, app ini punya 4 tab utama:

1. `Home`: pusat situasi hari ini.
2. `Chat`: pusat keputusan dan percakapan.
3. `Stats`: pusat evaluasi performa.
4. `Profile`: pusat kontrol akun, plan, dan environment.

Dengan seed yang tadi dijalankan, UI sekarang memang sengaja “dipenuhi” state supaya orang baru bisa melihat hampir semua perilaku app tanpa harus menunggu kejadian real.

**Apa Inti Produk Ini**

Produk ini dibangun di sekitar konsep:

- User punya beberapa habit aktif.
- Setiap habit punya hari target, jam reminder, dan deadline check-in.
- Setiap hari app menentukan status habit: belum mulai, sudah dekat deadline, sudah lewat, sudah dicatat, atau memang rest day.
- User bisa mencatat hasil lewat quick action atau lewat chat.
- Sistem menyimpan history, streak, miss, bonus effort, workout detail, sampai review mingguan.

Jadi app ini bukan todo list biasa. Ini lebih dekat ke “habit operating system” dengan tekanan waktu dan evaluasi.

**Flow User Paling Dasar**

Flow paling normal untuk user baru:

1. Sign up / sign in.
2. Masuk dashboard.
3. Kalau belum onboarding, user bikin habit pertama.
4. Setelah itu Home jadi pusat aktivitas harian.
5. Saat reminder time/deadline mendekat, user lihat status di Home.
6. User bisa:
   - klik quick complete/miss,
   - buka detail habit,
   - atau masuk Chat untuk menjelaskan kondisinya.
7. Setelah beberapa hari, Stats mulai meaningful.
8. Setelah seminggu, weekly review muncul.
9. Di Profile user mengatur theme, billing, notification, dan sekarang dev AI toggle.

**Home Itu Buat Apa**

Tab `Home` adalah jawaban untuk pertanyaan: “Hari ini gue harus ngapain, dan kondisinya sekarang seberapa urgent?”

Yang ditampilkan di Home:

- `Summary Status Card` di paling atas:
  - menunjukkan tanggal dan jam sekarang,
  - menunjukkan habit utama hari ini,
  - menunjukkan status harian secara singkat,
  - menunjukkan CTA utama seperti `Open chat`.
- Daftar `habit cards`:
  - tiap card = satu habit,
  - card punya tone visual berbeda sesuai status,
  - card menunjukkan reminder time, deadline, streak, rules, motivation, dan action buttons.

Tujuan Home:

- bikin user paham situasi hari itu dalam beberapa detik,
- mengurangi friction untuk aksi cepat,
- memberi rasa urgency.

**Makna State Card di Home**

Dengan seed, Anda sekarang lihat banyak state sekaligus. Ini gunanya untuk test semua behavior visual.

State-state utamanya:

- `Upcoming`
  - habit dijadwalkan hari ini, tapi reminder/deadline masih jauh.
  - tujuan UI: bilang “ini belum mendesak, tapi sudah ada di radar.”
- `Due Soon`
  - waktunya sudah mulai dekat.
  - tujuan UI: dorong user bersiap.
- `Deadline Risk`
  - sudah mepet deadline.
  - tujuan UI: kasih tekanan keras, visual lebih agresif.
- `Overdue` / missed pressure
  - deadline lewat atau habit dianggap gagal.
  - tujuan UI: user tahu ini bukan pending lagi, ini masalah.
- `Logged`
  - check-in untuk hari ini sudah ada.
  - tujuan UI: kasih closure.
- `Rest Day`
  - habit tidak dijadwalkan hari ini.
  - tujuan UI: mengurangi noise.
- `Bonus`
  - user melakukan sesuatu walau bukan hari target.
  - tujuan UI: effort tetap terlihat, tapi tidak mengacaukan target utama.
- `Paused habit`
  - habit ada tapi tidak aktif.
  - tujuan UI: history tetap ada, scheduling berhenti.

**Elemen Penting di Satu Habit Card**

Setiap card habit kurang lebih menjawab:

- ini habit apa,
- hari ini statusnya apa,
- kapan reminder,
- kapan deadline,
- streak-nya berapa,
- rules habit ini apa,
- kenapa habit ini penting,
- apa aksi tercepat sekarang.

Action di card:

- `Check in` / mark done
- `Acknowledge miss`
- `Chat with coach`
- `Details`
- `Pause/Resume`
- `Delete`

Jadi satu card itu bukan cuma display, tapi command center kecil untuk habit itu.

**Chat Itu Buat Apa**

Tab `Chat` adalah tempat user berinteraksi dengan “coach”.

Fungsi chat:

- log completion dengan bahasa natural,
- log miss,
- kasih alasan,
- minta plan hari ini,
- minta plan besok,
- reschedule habit,
- skip habit untuk tanggal tertentu,
- bikin task/planner item,
- minta review/pattern insight.

Bedanya dengan Home:

- Home itu cepat dan deterministic.
- Chat itu fleksibel dan conversational.

Seed sekarang sudah mengisi chat supaya orang baru bisa langsung lihat:

- message user,
- response coach,
- weekly review message,
- planning-style message.

**Coach Context Rail di Chat**

Di atas chat ada context rail.
Tujuannya:

- menunjukkan habit utama yang sedang relevan,
- menunjukkan pressure state yang sama dengan Home,
- menyediakan `Load prompt`,
- membuat chat terasa kontekstual, bukan blank screen.

Artinya, chat bukan ruang obrolan umum. Ia selalu dihubungkan ke state kebiasaan user.

**Quick Actions di Chat**

Chat juga punya quick actions.
Contohnya:

- `Mark today done`
- `I skipped today`
- `Ask coach`
- `Prep with coach`
- `Review today`

Tujuannya:

- mempercepat pesan-pesan paling umum,
- mengurangi user harus mengetik dari nol,
- menjaga flow tetap terasa “operasional”.

**Budget Chat / Tier**

Di chat ada indikator budget harian.
Artinya:

- user free punya batas message harian,
- user pro unlimited,
- kalau limit habis, chat jadi read-only dan UI menawarkan `Upgrade to Pro`.

Di dev, Anda masih bisa swap tier secara manual.
Di production nanti flow upgrade diarahkan ke halaman plan/payment.

**Stats Itu Buat Apa**

Tab `Stats` menjawab pertanyaan: “Secara sistem, performa gue gimana?”

Yang ditampilkan:

- `Today Focus`
  - kondisi paling penting hari ini,
  - apakah ada miss, pending, atau all clear.
- heat/box overview minggu berjalan
  - semacam ringkasan per hari.
- angka aggregate:
  - best streak,
  - system misses,
  - completed,
  - bonus.
- `Latest Weekly Review`
  - rangkuman mingguan paling baru.
- per-habit performance block
  - check-ins minggu ini,
  - recent workout logs,
  - detail habit link.

Tujuan Stats:

- memberi feedback loop,
- membuat progress dan kegagalan terlihat jelas,
- membantu user melihat pola, bukan cuma satu kejadian.

**Weekly Review Itu Apa**

Weekly review adalah evaluasi mingguan per habit.
Isinya biasanya:

- target count minggu itu,
- actual completion,
- bonus count,
- completion rate,
- roast/review text,
- missed reasons.

Tujuan weekly review:

- mengubah data mingguan jadi narasi,
- membuat user sadar pola,
- memberi bahan refleksi yang lebih kuat dari sekadar angka.

Seed tadi juga membuat satu weekly review supaya tab Stats tidak kosong.

**Detail Habit Panel Itu Buat Apa**

Saat user klik `Details`, keluar side panel detail habit.

Isi panel ini:

- form edit habit,
- schedule default,
- Friday override kalau ada,
- rules,
- motivation,
- status paused/active,
- grid minggu ini,
- recent history check-ins,
- recent workout logs.

Tujuan panel ini:

- jadi “halaman habit” tanpa keluar dari dashboard,
- memudahkan audit satu habit secara mendalam,
- tempat edit konfigurasi habit.

Jadi Home memberi snapshot, detail panel memberi zoom-in.

**Profile Itu Buat Apa**

Tab `Profile` adalah tempat kontrol sistem.

Isinya sekarang:

- email account,
- current tier,
- daily messages used,
- messages remaining,
- AI mode,
- notification status,
- theme mode,
- tombol upgrade/downgrade,
- tombol enable reminders,
- dev-only AI disable button,
- stats readout ringan.

Tujuan Profile:

- semua “meta controls” dikumpulkan di satu tempat,
- user tidak perlu membongkar flow utama untuk urusan account/env.

**AI Mode Dev Button Itu Apa**

Ini penting untuk dev/testing.

Kalau `AI Disabled` ditekan:

- agent tidak jalan,
- model call tidak jalan,
- reminder AI flow tidak jalan,
- weekly review generation tidak jalan,
- agent memory refresh tidak jalan.

Tujuan tombol ini:

- menjaga seed/test state tetap stabil,
- mencegah token model habis saat eksplorasi UI,
- memungkinkan frontend review tanpa noise dari automation.

Ini memang hanya muncul di dev. Di production tombol ini hilang.

**Upgrade / Downgrade Behavior Sekarang**

Di dev:

- ada `Upgrade to Pro`
- ada `Downgrade`
- ini dipakai untuk cepat test gating UI

Di production:

- `Downgrade` disembunyikan
- `Upgrade to Pro` tidak lagi toggle metadata langsung
- sekarang diarahkan ke halaman placeholder `/plans`

Tujuannya:

- memisahkan tooling dev dari behavior production,
- menyiapkan transisi ke Clerk billing/payment flow yang proper.

**Notification / Reminder Itu Apa**

Reminder di app ini bukan cuma alarm visual.
Secara konsep:

- habit punya reminder time,
- habit punya deadline,
- sistem bisa punya beberapa jenis reminder state,
- reminder berhubungan dengan chat dan perilaku user.

Di UI sekarang, efek reminder terlihat lewat:

- state card di Home,
- status notification di Profile,
- message reminder di Chat kalau memang ada.

Tujuan reminder:

- menjaga momentum,
- memberi tekanan sebelum deadline,
- membuat check-in terasa time-bound.

**Check-in, Miss, Bonus Itu Bedanya Apa**

- `Completed`
  - target utama hari itu berhasil.
- `Missed`
  - target hari itu gagal/terlewat.
- `Bonus`
  - user melakukan effort tambahan di luar target normal.

Kenapa dipisah:

- completed memengaruhi target harian dan streak,
- miss memutus streak,
- bonus memberi penghargaan tanpa mengacaukan baseline habit plan.

**Rules dan Motivation Itu Kenapa Penting**

Setiap habit punya:

- `Rules`
- `Motivation`

Rules:

- definisi “apa yang dianggap valid”
- contoh: workout minimal 30 menit

Motivation:

- alasan personal kenapa habit itu penting

Di UI, dua hal ini penting karena:

- user tidak cuma lihat “nama habit”
- user diingatkan standar dan alasan
- mengurangi ambiguity waktu check-in

**Seed yang Baru Dijalankan Itu Menunjukkan Apa**

Seed tadi sengaja dipakai untuk “teaching environment”.
Ia membuat:

- semua state Home muncul,
- chat tidak kosong,
- stats tidak kosong,
- weekly review terlihat,
- workout logs terlihat,
- paused habit ada,
- profile bisa dicek dalam konteks realistis.

Jadi kalau ngajarin orang baru, seed ini adalah sandbox visual untuk memahami seluruh aplikasi tanpa harus menunggu beberapa hari penggunaan nyata.

**Cara Menjelaskan App Ini ke Orang Baru dengan Singkat**

Kalau saya harus ngajarin orang baru secara simpel:

- Home = apa yang penting hari ini.
- Chat = tempat ngomong ke coach dan menggerakkan sistem.
- Stats = tempat lihat hasil dan pola.
- Profile = tempat kontrol akun dan environment.
- Habit = unit utama yang punya hari target, reminder, deadline, rules, motivation.
- Check-in = bukti hasil hari itu.
- Weekly review = evaluasi satu minggu.
- Pro = chat unlimited.
- AI dev off = freeze automation supaya aman untuk testing UI.

**Urutan Belajar App untuk Orang Baru**

Saya sarankan ngajarnya urut begini:

1. Mulai dari `Home` dulu.
2. Jelaskan arti status card.
3. Masuk ke `Details` salah satu habit.
4. Setelah itu ke `Chat` dan jelaskan quick actions + natural language flow.
5. Lalu ke `Stats` untuk tunjukkan bagaimana history diterjemahkan jadi insight.
6. Terakhir ke `Profile` untuk kontrol system-level.

Kalau langsung mulai dari chat atau schema, orang baru biasanya belum punya mental map.

**Satu Kalimat Posisi Produk**

Ini adalah app habit accountability yang menggabungkan quick action dashboard, conversational coach, dan evaluasi performa supaya user bukan cuma mencatat kebiasaan, tapi dipaksa melihat konsekuensi dan progresnya.

Kalau Anda mau, next saya bisa bikin versi yang lebih formal:

- `User manual`
- `Onboarding guide`
- atau `tour script` tab-by-tab yang siap ditempel ke docs internal.
