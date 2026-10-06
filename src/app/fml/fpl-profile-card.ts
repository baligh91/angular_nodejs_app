import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FplProfile } from './models';

@Component({
  selector: 'app-fpl-profile-card',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <p class="eyebrow">PUBLIC FPL PROFILE #{{profile().id}}</p>
      <h2>{{profile().firstName}} {{profile().lastName}}</h2>
      <p>FPL team: <strong>{{profile().teamName}}</strong></p>
      <div class="stats-grid">
        <div><span>Season points</span><strong>{{profile().overallPoints !== null ? (profile().overallPoints | number) : 'Not available'}}</strong></div>
        <div><span>Overall FPL rank</span><strong>{{profile().overallRank !== null ? (profile().overallRank | number) : 'Not ranked'}}</strong></div>
        <div><span>FPL gameweek points</span><strong>{{profile().gameweekPoints !== null ? (profile().gameweekPoints | number) : 'Not available'}}</strong></div>
      </div>
      <p>Gameweek FPL rank: {{profile().gameweekRank !== null ? (profile().gameweekRank | number) : 'Not ranked'}}</p>
      <p>Favorite club: {{profile().favoriteTeam?.name ?? 'Not set in FPL'}}</p>
      <p><a [href]="'https://fantasy.premierleague.com/entry/' + profile().id + '/history/'" target="_blank" rel="noopener noreferrer">View official FPL history</a></p>
      <p class="muted">Only public FPL data is available. Private email, account credentials and private account details are never requested.</p>
    </section>
  `,
})
export class FplProfileCard {
  readonly profile = input.required<FplProfile>();
}
