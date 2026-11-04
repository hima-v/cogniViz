import sys, numpy as np, pandas as pd, joblib
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, KFold, RepeatedKFold, cross_val_score
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error
D = sys.argv[1]
df = pd.read_csv(f"{D}/data/msv_df_imputed.csv")
f11 = ['tempo','loudness','spec_centroid','brightness','saturation','entropy','warmness','facec_ps','shotc_ps','faced_ps','shotd_ps']
print("rows", len(df), "NaNs in f11:", int(df[f11].isna().sum().sum()), "NaN y:", int(df.perceived_msv.isna().sum()))
std = df.copy(); sc = StandardScaler(); std[f11] = sc.fit_transform(std[f11])
Xtr, Xte, ytr, yte = train_test_split(std[f11], std.perceived_msv, test_size=0.1, random_state=0)
print("train/test", len(Xtr), len(Xte), "baseline var", round(np.var(yte),4))
P = dict(random_state=0, max_depth=7, max_features='log2', min_samples_split=5, n_estimators=30)
rf = RandomForestRegressor(**P).fit(Xtr, ytr)
mse = mean_squared_error(yte, rf.predict(Xte)); n=len(Xte)
print("TEST MSE", round(mse,4), "AIC", round(2*11 + n*np.log(mse),3))
print("\nFeature importance:"); print(pd.Series(rf.feature_importances_, f11).sort_values(ascending=False).round(3).to_string())
top3 = pd.Series(rf.feature_importances_, f11)[['faced_ps','shotd_ps','brightness']].sum(); print("top3 sum", round(top3,3))
# shipped model
m = joblib.load(f"{D}/model/msv_model.joblib"); s = joblib.load(f"{D}/model/msv_scaler.joblib")
print("\nshipped model params:", {k:m.get_params()[k] for k in P})
print("shipped model test MSE", round(mean_squared_error(yte, m.predict(Xte)),4), "| identical preds to mine:", np.allclose(m.predict(Xte), rf.predict(Xte)))
print("scaler identical:", np.allclose(s.mean_, sc.mean_), np.allclose(s.scale_, sc.scale_))
pred = rf.predict(std[f11]); print("predicted MSV all 1200: M %.2f SD %.2f min %.2f max %.2f" % (pred.mean(), pred.std(ddof=1), pred.min(), pred.max()))
# CV variants (no CV code in notebook)
X, y = std[f11], std.perceived_msv
def cv(cvobj): return -cross_val_score(RandomForestRegressor(**P), X, y, cv=cvobj, scoring='neg_mean_squared_error').mean()
print("\n10-fold CV MSE variants:")
print(" KFold(10) no shuffle        ", round(cv(KFold(10)),4))
print(" KFold(10) shuffle rs=0      ", round(cv(KFold(10, shuffle=True, random_state=0)),4))
for r in [1,3,5,10]:
    print(f" RepeatedKFold(10, {r:2d} rep, rs=0)", round(cv(RepeatedKFold(n_splits=10, n_repeats=r, random_state=0)),4))
vals=[cv(KFold(10, shuffle=True, random_state=s)) for s in range(50)]
print(" KFold shuffle seeds 0-49: mean %.4f  min %.4f  max %.4f" % (np.mean(vals), min(vals), max(vals)))
