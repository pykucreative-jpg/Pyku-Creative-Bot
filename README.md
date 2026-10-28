# P.Y.K.U CREATIVE

Bot Discord: oferta z własnymi opisami i cenami, przyciski zamówień oraz prywatne zgłoszenia DM ↔ kanał obsługi.

## Railway

Połącz to repozytorium z usługą Railway. Dockerfile jest w głównym folderze projektu. W Variables dodaj:

```
DISCORD_TOKEN=token Twojego bota
GUILD_ID=ID Twojego serwera
```

Token wpisuj wyłącznie w Variables Railway. Nie dodawaj go do repozytorium.

Jedynym operatorem bota jest użytkownik `795755381744861184`. Tylko on może publikować ofertę, odpowiadać klientom i zamykać zgłoszenia; administratorzy i role nie omijają tej kontroli. Klienci mogą używać przycisków i pisać na DM. Discord pozwala administratorom serwera zobaczyć prywatne kanały, ale bot nie przekaże ich odpowiedzi klientom. Przy starcie bot ustawia dostęp do swoich istniejących kanałów zgłoszeń dla właściciela i bota, usuwając dawne wpisy dostępu roli obsługi.

W Discord Developer Portal włącz **Message Content Intent**. Zaproś bota z uprawnieniami wskazanymi w START-TUTAJ.md. Po wpisaniu zmiennych uruchom wdrożenie ponownie. Uruchamiaj jedną replikę usługi; bot nie wymaga domeny ani publicznego portu. Wyłącz usypianie usługi, jeśli jest dostępne. Hosting może wymagać środków na koncie Railway.

Po uruchomieniu użyj `/panel` na swoim serwerze. Ceny i opisy możesz zmienić w opcjach komendy. `/zamknij` zamyka zgłoszenie. Zwykłe wiadomości obsługi na aktywnym kanale zgłoszenia trafiają do klienta na DM.

Pełna instrukcja i zakres sprawdzenia: [START-TUTAJ.md](START-TUTAJ.md).
