# BTL Africa — Création d’utilisateurs

Interface React/Vite mobile-first pour enregistrer un nouvel utilisateur ou agent dans la table existante `public.users` de BTL Africa Privilege Tracker.

## Ce qui est inclus

L’interface propose une validation MSISDN en temps réel, un contrôle anti-doublon à trois niveaux, une liste de superviseurs filtrée par rôle, les catégories de campagne distinctes, la règle « Aucun shop » vers `null`, un état de chargement non bloquant, les toasts de succès/erreur, un récapitulatif non sensible après création, un tableau de bord administrateur sécurisé et un mode démo explicite lorsque Supabase n’est pas configuré.

Le code est organisé dans le template WebDev React :

| Cahier des charges | Fichier du projet |
| --- | --- |
| `index.html` | `client/index.html` |
| `styles.css` | `client/src/index.css` — thème global de l’interface |
| `app.js` | `client/src/App.tsx` + `client/src/pages/Home.tsx` |
| Module téléphone | `client/src/lib/phone.ts` |
| Module Supabase | `client/src/lib/supabase.ts` |
| Dashboard | `client/src/pages/AdminDashboard.tsx` |
| Règles du formulaire | `client/src/lib/user-form.ts` |
| Tests | `client/src/lib/phone.test.ts` et `client/src/lib/supabase.test.ts` |

## Branchement Supabase

Pour une configuration au démarrage, créez un fichier `.env.local` à la racine du projet et renseignez :

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

`VITE_SUPABASE_ANON_KEY` est également accepté pour les projets qui utilisent encore l’ancien nom de variable. Redémarrez ensuite le serveur Vite.

Vous pouvez aussi renseigner les valeurs directement dans **Dashboard → Configurer**. Cette configuration runtime est conservée localement pour restaurer la connexion après rechargement ; elle est effacée quand le projet est déconnecté. La clé Supabase est toujours saisie dans un champ masqué et les clés contenant `service_role` sont refusées.

Après configuration, le dashboard demande une connexion **par MSISDN et mot de passe existant** avant de lire `public.users`. Le numéro local `0812345678` est essayé avec son équivalent international `+243812345678`, puis la ligne est vérifiée avec la valeur déjà utilisée dans `password_hash`. Aucun nouveau mécanisme d’authentification n’est introduit. Le profil correspondant détermine le rôle. L’écran n’affiche pas les données fictives dans ce parcours réel.

Le rôle `super_admin` est le seul autorisé à ouvrir le formulaire **Nouvel utilisateur**. Les rôles `agent`, `supervisor`, `sub_admin` et `admin` peuvent se connecter au dashboard, rechercher, filtrer, actualiser et exporter les données, mais restent en **lecture seule**. Les politiques RLS du projet doivent autoriser l’utilisateur authentifié à sélectionner les colonnes nécessaires et doivent réserver l’insertion à la logique d’administration autorisée.

## Création de compte et approbation

L’écran de connexion propose désormais deux options : **Se connecter** et **Créer un compte**. Le signup crée exclusivement une demande d’accès de rôle `agent` dans `public.user_registration_requests`; il ne crée jamais directement une ligne dans `public.users`. La demande reste `pending` jusqu’à l’action d’un `super_admin`, puis l’approbation crée l’agent dans `public.users`. Les agents pending ne sont donc pas renvoyés par la liste principale et ne peuvent pas apparaître dans les listes opérationnelles avant validation.

La migration à exécuter dans le projet Supabase est [`supabase/migrations/202609210001_registration_requests.sql`](supabase/migrations/202609210001_registration_requests.sql). Elle crée la table, son index anti-doublon sur les demandes pending et quatre fonctions RPC `SECURITY DEFINER` : création de demande publique, lecture super_admin, approbation et rejet. Le projet utilise une authentification métier basée sur `public.users.password_hash` et non Supabase Auth; les RPC reviewer valident donc explicitement l’UUID et le rôle `super_admin` avant toute lecture ou mutation.

Pour activer les champs complémentaires du compte, exécutez ensuite [`supabase/migrations/202609210011_registration_profile_details.sql`](supabase/migrations/202609210011_registration_profile_details.sql). Cette migration ajoute le numéro M-Pesa (`phone`), le numéro WhatsApp et son indicateur « même numéro », la date de naissance, l’adresse et la photo de profil aux demandes et aux utilisateurs. Elle remplace les RPC de signup, d’approbation et de création superadmin avec leurs signatures étendues.

Les campagnes existantes sont lues depuis `public.campaigns` et les affectations actives depuis `public.user_campaign_assignments`. La migration [`supabase/migrations/202609210002_campaign_assignments_rpc.sql`](supabase/migrations/202609210002_campaign_assignments_rpc.sql) ajoute la RPC `set_user_campaign_assignments`, réservée aux rôles `admin`, `super_admin` et `supervisor`. Elle permet plusieurs campagnes par agent, désactive les anciennes affectations retirées et vérifie la compatibilité entre une campagne hôtesse ou Brand Ambassador et la catégorie de l’agent.

Les vues par rôle utilisent les données métier existantes : `daily_reports` pour les hôtesses et `ba_daily_attendance` via `campaign_runs` pour les Brand Ambassadors. La migration [`supabase/migrations/202609210003_campaign_assignment_requests.sql`](supabase/migrations/202609210003_campaign_assignment_requests.sql) crée les demandes d’affectation des agents ainsi que les RPC de consultation et de validation par les managers. La migration [`supabase/migrations/202609210004_user_profile_updates.sql`](supabase/migrations/202609210004_user_profile_updates.sql) conserve le stockage direct des mots de passe et exige uniquement le mot de passe actuel avant une modification de profil.

Les superadmins disposent également d’une barre **Simulation superadmin** persistante. Le sélecteur custom présente tous les utilisateurs par ordre alphabétique et les raccourcis `AG`, `SUP` et `ADM` ciblent respectivement `Agent Test`, `Hervé Ntalu` et `Bradley`. La simulation remplace uniquement le profil affiché : la session réelle reste celle du superadmin, la barre reste visible et le bouton **Quitter** restaure le compte réel. Les vues simulées sont consultatives afin d’éviter toute écriture accidentelle dans la base.

Dans l’espace agent, les coordonnées téléphoniques des administratifs ne sont plus affichées dans la liste. Le superviseur direct reste cliquable et ouvre une fiche avec son téléphone copiable, toute sa chaîne hiérarchique et les campagnes compatibles de l’agent. Une demande créée depuis cette fiche est enregistrée dans `campaign_assignment_requests`. La migration [`supabase/migrations/202609210007_supervisor_assignment_visibility.sql`](supabase/migrations/202609210007_supervisor_assignment_visibility.sql) garantit qu’un superviseur ne reçoit que les demandes de ses propres agents, tandis que les rôles admin, coordination et superadmin conservent une vue globale.

La création manuelle depuis l’espace superadmin utilise désormais la RPC `create_user_by_super_admin` au lieu d’un `INSERT` direct depuis le navigateur. Exécutez [`supabase/migrations/202609210008_superadmin_user_creation_rpc.sql`](supabase/migrations/202609210008_superadmin_user_creation_rpc.sql) avant d’utiliser cette fonctionnalité sur un projet existant. Le dashboard propose également une bascule **Vue liste / Vue cartes** ; les clics sur une carte et les boutons d’action conservent le même comportement que dans la table.

Si le projet possède une contrainte `NOT NULL` sur `public.users.user_category`, exécutez ensuite [`supabase/migrations/202609210009_fix_user_category_for_admin_creation.sql`](supabase/migrations/202609210009_fix_user_category_for_admin_creation.sql). Les profils non agents recevront automatiquement la catégorie technique `operations`, tandis que les campagnes restent réservées aux catégories agent compatibles.

La connexion métier est persistée localement sans enregistrer le mot de passe : la configuration Supabase et le profil courant sont restaurés au rechargement, puis supprimés lors de la déconnexion. Le logo officiel Beyond The Line est servi en WebP léger, avec une icône PWA versionnée pour éviter le favicon obsolète. Les photos de profil sont stockées dans `public.users.avatar_url`, affichées dans le hero et les fiches, avec choix, aperçu et suppression depuis l’icône d’édition du profil.

Après connexion, un agent voit ses responsables, ses campagnes et un suivi combinant courbe de performance et registre de présence. Chaque date travaillée du calendrier est cliquable : elle ouvre le rapport journalier ou le registre de clôture, avec une alerte visuelle lorsque le commentaire n’a pas été envoyé. Un superviseur voit ses responsables, ses agents et peut ouvrir la fiche d’un agent, appeler l’agent, sélectionner une campagne, approuver une demande et exporter le suivi au format XLSX ou PDF. Dans la console admin, le clic sur un agent ouvre cette même fiche; l’édition reste accessible dans la fiche et par l’action crayon.

**Ne renseignez jamais une clé `service_role` dans une variable `VITE_*` ou dans le frontend.** Si une opération d’administration exige des privilèges élevés, utilisez une RPC ou une Edge Function Supabase sécurisée, puis appelez-la depuis le frontend avec la clé publishable/anon et des politiques RLS adaptées.

Sans ces variables, le formulaire affiche **Mode démo actif** avec un petit jeu de données en mémoire pour tester l’interface. Le dashboard, lui, masque ces données et demande d’abord une configuration Supabase réelle. Aucun mot de passe n’est stocké dans `localStorage` ou l’URL ; la connexion reste en mémoire jusqu’à la fermeture ou la déconnexion.

## Dashboard et historique MSISDN

Le dashboard permet de rechercher rapidement un nom ou un MSISDN — le format `+24381…` est normalisé avant la comparaison — puis de filtrer par rôle et catégorie. Les graphiques sont placés au-dessus de la barre de filtres, qui reste juste au-dessus de la liste. La liste propose une vue table ou cartes, et le bouton **Nouvel utilisateur** est regroupé avec les contrôles de liste. L’export ouvre un aperçu proposant CSV, XLSX et PDF ; dans cet aperçu, les raccourcis `C`, `X` et `P` déclenchent directement le format correspondant.

## Schéma cible et payload

La table principale reste `public.users`. Les parcours déjà intégrés utilisent également les tables métier existantes `campaigns`, `user_campaign_assignments`, `campaign_runs`, `campaign_pauses`, `daily_reports` et `ba_daily_attendance`, ainsi que les tables de demandes créées par les migrations indiquées plus haut. L’application ne crée pas de table métier implicite côté navigateur.

Exemple de payload strict, limité aux colonnes autorisées :

```json
{
  "id": "6a3ecb0e-f3b2-4fd8-9f12-bb9dc2b2fa8d",
  "full_name": "Grâce Mbuyi",
  "phone": "0812345678",
  "password_hash": "<valeur conforme au mécanisme d’authentification existant>",
  "role": "agent",
  "user_category": "hostess",
  "supervisor_id": "b7d7aef4-2e2b-4a7e-9f12-1d5ce8481b0a",
  "permanent_shop_id": null
}
```

L’interface normalise toujours le téléphone au format local `0XXXXXXXXX` avant la recherche et l’insertion. « Aucun shop » est transformé en `null`, jamais enregistré comme une chaîne.

## Identifiants utilisateurs

Dans le projet Supabase cible, le champ `public.users.id` est de type **text**. Les demandes d’inscription utilisent un UUID interne, converti explicitement en texte uniquement au moment de l’approbation afin de rester compatible avec le schéma existant. Aucun identifiant réel n’est hardcodé dans l’application métier et le code ne suppose jamais que les identifiants sont séquentiels.

## Contrôle anti-doublon

1. **Validation locale** : nettoyage des espaces, tirets, points, parenthèses et `+`, validation du préfixe `08`/`09` et du nombre de chiffres.
2. **Lookup Supabase debounced** : recherche ciblée `.eq('phone', normalizedPhone)` après 420 ms, avec invalidation des requêtes obsolètes.
3. **Contrainte unique PostgreSQL** : une erreur `23505` ou une erreur mentionnant `phone` est convertie en message anti-doublon professionnel.

Les rôles proposés sont strictement `agent`, `supervisor`, `sub_admin`, `admin` et `super_admin`. Les catégories sont strictement `hostess`, `brand_ambassador`, `brand_ambassador_youth` et `operations`.

## Développement et tests

```bash
pnpm install
pnpm dev
pnpm check
pnpm exec vitest run client/src/lib/phone.test.ts client/src/lib/supabase.test.ts
pnpm build
```

Le bouton **Créer l’utilisateur** est désactivé tant que le nom, le MSISDN ou le contrôle anti-doublon n’est pas valide. L’accès au formulaire est en plus réservé au profil `super_admin`. Le formulaire reste utilisable au clavier et sur mobile.

Toutes les occurrences de téléphone rendues dans l’interface utilisent maintenant le bouton `CopyablePhone`; un clic copie le numéro brut dans le presse-papier, avec un fallback compatible lorsque l’API Clipboard n’est pas disponible. Les modales du dashboard sont rendues dans `document.body` via un portal, avec une hauteur indépendante du contenu de la page et un scroll interne uniquement lorsque nécessaire.
