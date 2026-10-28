# P.Y.K.U CREATIVE

## Oferty ze zdjęciami

`/oferta nazwa:... opis:... cena:...` publikuje osobną kartę oferty jako wiadomość bota. Opcjonalne `zdjecie`, `zdjecie_2` ... `zdjecie_10` tworzą galerię (PNG/JPG/GIF/WEBP). `kanal` wybiera miejsce publikacji. Opis obsługuje zapis `\n` jako nowy wiersz. Przycisk „Zapytaj o ofertę / zamów” wysyła klientowi DM i otwiera zgłoszenie z nazwą, ceną i linkiem do oferty. Potwierdzenie publikacji widzi tylko operator.

Więcej zdjęć: na kanale oferty użyj `/zdjecia oferta_id:ID_WIADOMOŚCI zdjecie:PLIK`. Możesz dodać do 10 zdjęć na jedno wywołanie i powtarzać komendę. Każda kolejna partia pojawia się w osobnej wiadomości pod ofertą z przyciskiem kontaktu do oryginalnej oferty. ID dostaniesz w prywatnym potwierdzeniu `/oferta`. Zdjęcia są przesyłane ponownie jako załączniki bota.

Komendy i odpowiedzi w zgłoszeniach są dostępne dla właściciela oraz rangi `1562454115206955059`. Zamknięte zgłoszenia nie przekazują wiadomości na DM.

`dzial:auta` przy `/oferta` ustawia przycisk „Zapytaj o auto / zamów”. Pozostałe oferty mają przycisk „Zapytaj o ofertę / zamów”. Bot publikuje na bieżącym lub wskazanym istniejącym kanale — nie tworzy kanałów ofert.

Tickety są rozdzielone: `PYKU • TICKETY Z OFERT` obsługuje zapytania z przycisków konkretnych ofert (osobna rozmowa na klienta i ofertę), a `PYKU • ZGŁOSZENIA` obsługuje usługi i kontakt ogólny z panelu. Kategorie ticketów powstają przy pierwszym zgłoszeniu. Gdy klient ma kilka aktywnych zgłoszeń, po każdej wiadomości DM wybiera przyciskiem, do którego zgłoszenia ją przekazać. Jeśli ma tylko jedno, wiadomość trafia tam automatycznie. Podział i przypisanie do ofert działają także po restarcie.

Bot Discord: oferta z własnymi opisami i cenami, przyciski zamówień oraz prywatne zgłoszenia DM ↔ kanał obsługi.

## Railway

Połącz to repozytorium z usługą Railway. Dockerfile jest w głównym folderze projektu. W Variables dodaj:

```
DISCORD_TOKEN=token Twojego bota
GUILD_ID=ID Twojego serwera
```

Token wpisuj wyłącznie w Variables Railway. Nie dodawaj go do repozytorium.

Operatorami bota są użytkownik `795755381744861184` i członkowie roli `1562454115206955059`. Mogą publikować oferty, odpowiadać klientom i zamykać zgłoszenia. Pozostali administratorzy nie omijają tej kontroli. Klienci mogą używać przycisków i pisać na DM. Discord pozwala administratorom serwera zobaczyć prywatne kanały, ale bez roli obsługi bot nie przekaże ich odpowiedzi klientom. Przy starcie bot ustawia dostęp do swoich istniejących kanałów zgłoszeń dla właściciela, bota i wskazanej roli obsługi.

W Discord Developer Portal włącz **Message Content Intent**. Zaproś bota z uprawnieniami wskazanymi w START-TUTAJ.md. Po wpisaniu zmiennych uruchom wdrożenie ponownie. Uruchamiaj jedną replikę usługi; bot nie wymaga domeny ani publicznego portu. Wyłącz usypianie usługi, jeśli jest dostępne. Hosting może wymagać środków na koncie Railway.

Po uruchomieniu użyj `/panel` na swoim serwerze. Ceny i opisy możesz zmienić w opcjach komendy. `/zamknij` zamyka zgłoszenie. Zwykłe wiadomości obsługi na aktywnym kanale zgłoszenia trafiają do klienta na DM.

Pełna instrukcja i zakres sprawdzenia: [START-TUTAJ.md](START-TUTAJ.md).

