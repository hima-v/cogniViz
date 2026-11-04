import sys, numpy as np, pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import KFold, RepeatedKFold, cross_val_score
from sklearn.ensemble import RandomForestRegressor
df = pd.read_csv(f"{sys.argv[1]}/data/msv_df_imputed.csv")
f11=['tempo','loudness','spec_centroid','brightness','saturation','entropy','warmness','facec_ps','shotc_ps','faced_ps','shotd_ps']
X=StandardScaler().fit_transform(df[f11]); y=df.perceived_msv.values
P=dict(max_depth=7,max_features='log2',min_samples_split=5,n_estimators=30)
def cv(c,rf_rs=0): return -cross_val_score(RandomForestRegressor(random_state=rf_rs,**P),X,y,cv=c,scoring='neg_mean_squared_error',n_jobs=-1).mean()
hits=[(s,round(cv(KFold(10,shuffle=True,random_state=s)),4)) for s in range(200)]
v=[h[1] for h in hits]; print("KFold shuffle seeds 0-199: mean %.4f sd %.4f" % (np.mean(v),np.std(v)))
print("seeds giving 0.517 (rounded):", [h for h in hits if round(h[1],3)==0.517][:10])
print("RepeatedKFold 10x10, rs=1..5:", [round(cv(RepeatedKFold(n_splits=10,n_repeats=10,random_state=s)),4) for s in range(1,6)])
print("RF without random_state fixed (5 runs, KFold rs=0):", [round(cv(KFold(10,shuffle=True,random_state=0),None),4) for _ in range(5)])
