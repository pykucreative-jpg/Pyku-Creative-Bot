# P.Y.K.U CREATIVE — bot Discord

Oferta obejmuje skiny do broni, mody i citizeny, wszelkie ubrania do FiveM oraz optymalizację komputerów. Oferta ma domyślny cennik marki; ceny możesz nadpisać podczas publikacji.

## Pierwsze uruchomienie

1. Zainstaluj Node.js 24.17.0 lub nowszą wersję LTS: https://nodejs.org/.
2. Na https://discord.com/developers/applications utwórz aplikację „P.Y.K.U CREATIVE”. W zakładce Bot utwórz/skopiuj token. Nie udostępniaj go nikomu i nie wklejaj na czat.
3. Zaproś bota na swój serwer przez OAuth2 → URL Generator, zaznaczając `bot` oraz `applications.commands`. Uprawnienia: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Channels, Add Reactions. Bot nie potrzebuje Administratora. W zakładce Bot → Privileged Gateway Intents włącz **Message Content Intent**, aby mógł przekazywać zwykłe wiadomości obsługi. Po zmianie uruchom bota ponownie.
4. Właścicielem i jedynym operatorem bota jest konto 795755381744861184. To konto musi być członkiem serwera. Rola obsługi nie jest potrzebna.
5. W Discordzie włącz tryb dewelopera (Ustawienia → Zaawansowane). Skopiuj ID serwera przez menu prawego przycisku myszy.
6. Skopiuj `.env.example` do `.env`. Wpisz token oraz ID serwera. Zachowaj plik tylko u siebie.
7. Otwórz terminal w folderze bota i uruchom `npm install`, następnie `npm start`.
8. Na kanale oferty wpisz `/panel`. Dostępne są opcjonalne pola cen: `skiny`, `mody`, `ubrania`, `optymalizacja`. Wpisz np. „od 50 zł”, „100–200 zł” lub własny opis. Puste pole zachowuje domyślny cennik danej kategorii. Bot publikuje ofertę z Twoimi cenami i trzema przyciskami. Przycisk „Cennik” odczytuje ceny z tej konkretnej oferty, także po restarcie bota. Każde użycie `/panel` tworzy nową wiadomość; nie zmienia starszych ofert. Aby zastąpić ofertę, opublikuj nową i usuń starą wiadomość.

## Obsługa zamówień

Panel ma fioletowy akcent, nagłówek marki i pionowe sekcje usług z ceną bezpośrednio pod opisem. Przyciski znajdują się na dole. Potwierdzenie komendy jest widoczne tylko dla publikującego; oferta jest osobną wiadomością bota. Opcjonalne pole `kanal` w `/panel` pozwala wybrać kanał oferty, nawet gdy komendę uruchamiasz na prywatnym kanale administracji. Bot musi mieć uprawnienia do wysyłania wiadomości i osadzania linków na kanale docelowym.

Własne opisy wpisujesz w opcjonalnych polach `/panel`: `opis_skiny`, `opis_mody`, `opis_ubrania`, `opis_optymalizacja` (do 700 znaków każdy). Puste pole zachowuje gotowy opis danej usługi. Opisy i ceny dotyczą właśnie publikowanej oferty; nowe użycie komendy nie edytuje wcześniejszych wiadomości.

- Klient klika przycisk i odpowiada botowi na DM albo sam pisze do bota. Pierwsza wiadomość tworzy prywatny kanał w kategorii „PYKU • ZGŁOSZENIA”.
- Na kanale aktywnego zgłoszenia pisz normalnie. Bot automatycznie przekazuje wiadomości obsługi oraz linki do załączników klientowi na DM. Długie wiadomości dzieli na części. Bot przekazuje wyłącznie wiadomości właściciela 795755381744861184.
- Reakcja ✅ oznacza, że Discord przyjął całą odpowiedź do wysłania; nie oznacza jej przeczytania. Gdy wysłanie się nie powiedzie, bot opublikuje komunikat o błędzie. Do reakcji potrzebuje Add Reactions.
- Nie zapisuj na kanale aktywnego zgłoszenia prywatnych notatek — zwykłe wiadomości obsługi trafiają do klienta. W zamkniętych zgłoszeniach przekazywanie jest wyłączone. `/odpowiedz` pozostaje opcjonalną alternatywą.
- `/zamknij` archiwizuje zgłoszenie, zachowując kanał i historię. Nowa wiadomość klienta otworzy nowy ticket.
- Aktywne zgłoszenia są rozpoznawane po temacie kanału, również po ponownym uruchomieniu. Nie zmieniaj ręcznie tematów kanałów.

Kanały zgłoszeń mają dostęp ustawiony dla bota i właściciela 795755381744861184. Administratorzy serwera mogą je widzieć ze względu na zasady Discorda, ale nie mogą obsługiwać zgłoszeń przez bota. Bot przekazuje tekst i linki do załączników; nie synchronizuje edycji, usunięć, reakcji ani rozmów głosowych. Linki do załączników Discorda mogą wygasnąć — pobierz potrzebne pliki, zanim to nastąpi. Archiwa zajmują kanały serwera; usuwaj stare zgodnie z własną polityką przechowywania. Nie przesyłaj haseł ani danych płatniczych przez zgłoszenia.

Bot działa, gdy proces `npm start` jest uruchomiony. Do pracy całodobowej potrzebny jest stale włączony komputer lub hosting Node.js. Uruchamiaj jedną kopię bota. Przy większej skali potrzebne będą limity zgłoszeń i osobna baza danych.

## Status sprawdzenia

Kod przygotowano do uruchomienia, ale połączenie z Discordem wymaga Twojego tokenu i serwera. Przed przyjęciem zamówień sprawdź z drugiego konta: przyciski oferty, pierwszą wiadomość DM, odpowiedź z plikiem, zamknięcie, nowy ticket i powrót do aktywnej rozmowy po restarcie. Sprawdź też, że zwykły członek serwera nie widzi zgłoszeń.

Dokumentacja: https://discord.js.org/docs/packages/discord.js/main oraz https://discordjs.guide/legacy/popular-topics/partials.


